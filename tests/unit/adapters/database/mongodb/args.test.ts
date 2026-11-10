import { describe, it, expect } from "vitest";
import {
    buildConnectionUri,
    maskSecrets,
    parseMongoTarget,
    shellConnectionUri,
    toolConnection,
} from "@/lib/adapters/database/mongodb/args";

const base = { host: "mongo.internal", port: 27017, database: "shop" };
const withAuth = { ...base, user: "root", password: "s3cr3t" };

/**
 * Atlas is the case that drove this: the cluster hostname has no address record,
 * only an SRV record, so a `mongodb://host:port` connection fails DNS resolution
 * before it ever reaches the server.
 */
describe("parseMongoTarget", () => {
    it("keeps a plain host and port as they are", () => {
        expect(parseMongoTarget(base as never)).toEqual({
            authority: "mongo.internal:27017",
            host: "mongo.internal",
            port: 27017,
            srv: false,
            multiHost: false,
        });
    });

    it("selects SRV for an Atlas hostname", () => {
        const target = parseMongoTarget({ ...base, host: "cluster0.ab12c.mongodb.net" } as never);
        expect(target.srv).toBe(true);
        expect(target.authority).toBe("cluster0.ab12c.mongodb.net");
    });

    it("selects SRV for an explicit mongodb+srv scheme on any host", () => {
        const target = parseMongoTarget({ ...base, host: "mongodb+srv://mongo.example.com" } as never);
        expect(target).toMatchObject({ authority: "mongo.example.com", srv: true });
    });

    it("does not select SRV for a mongodb:// scheme", () => {
        expect(parseMongoTarget({ ...base, host: "mongodb://mongo.example.com" } as never).srv).toBe(false);
    });

    it("drops a trailing slash, path and query from the host", () => {
        expect(parseMongoTarget({ ...base, host: "mongo.internal/" } as never).host).toBe("mongo.internal");
        expect(parseMongoTarget({ ...base, host: "mongo.internal/shop?tls=true" } as never).host).toBe("mongo.internal");
    });

    it("drops the credentials of a pasted connection string", () => {
        const target = parseMongoTarget({
            ...base,
            host: "mongodb+srv://user:p%40ss@cluster0.ab12c.mongodb.net/db?retryWrites=true",
        } as never);
        expect(target).toMatchObject({ authority: "cluster0.ab12c.mongodb.net", srv: true });
    });

    it("lets a port typed into the host field win over the port field", () => {
        expect(parseMongoTarget({ ...base, host: "mongo.internal:27018" } as never)).toMatchObject({
            authority: "mongo.internal:27018",
            port: 27018,
        });
    });

    it("keeps a bracketed IPv6 literal intact", () => {
        expect(parseMongoTarget({ ...base, host: "[::1]:27018" } as never)).toMatchObject({
            authority: "[::1]:27018",
            host: "[::1]",
            port: 27018,
        });
    });

    it("reads a replica set seed list, filling the port field in where one is missing", () => {
        const target = parseMongoTarget({ ...base, host: "rs1.example.com:27018,rs2.example.com" } as never);
        expect(target).toMatchObject({
            authority: "rs1.example.com:27018,rs2.example.com:27017",
            multiHost: true,
            srv: false,
        });
    });

    it("falls back to the loopback address when no host is configured", () => {
        expect(parseMongoTarget({ port: 27017 } as never).host).toBe("127.0.0.1");
    });
});

describe("buildConnectionUri", () => {
    it("builds a host and port URI for a normal server", () => {
        expect(buildConnectionUri(withAuth as never)).toBe(
            "mongodb://root:s3cr3t@mongo.internal:27017/?authSource=admin",
        );
    });

    it("builds an SRV URI without a port for an Atlas cluster", () => {
        const uri = buildConnectionUri({ ...withAuth, host: "cluster0.ab12c.mongodb.net" } as never);
        expect(uri).toBe("mongodb+srv://root:s3cr3t@cluster0.ab12c.mongodb.net/?authSource=admin");
        expect(uri).not.toContain("27017");
    });

    it("honours the authentication database", () => {
        const uri = buildConnectionUri({ ...withAuth, authenticationDatabase: "app" } as never);
        expect(uri).toContain("?authSource=app");
    });

    it("percent-encodes credentials", () => {
        const uri = buildConnectionUri({ ...withAuth, user: "a@b", password: "p@ss/word" } as never);
        expect(uri).toContain("a%40b:p%40ss%2Fword@");
    });

    it("keeps a replica set seed list in the authority", () => {
        const uri = buildConnectionUri({ ...withAuth, host: "rs1.example.com:27018,rs2.example.com" } as never);
        expect(uri).toBe(
            "mongodb://root:s3cr3t@rs1.example.com:27018,rs2.example.com:27017/?authSource=admin",
        );
    });

    it("still honours a stored inline uri from before that field was deprecated", () => {
        const uri = "mongodb+srv://legacy:pw@cluster0.ab12c.mongodb.net/?retryWrites=true";
        expect(buildConnectionUri({ ...withAuth, uri } as never)).toBe(uri);
    });
});

describe("shellConnectionUri", () => {
    it("connects mongosh directly to a single host, as the tools do for one --host", () => {
        expect(shellConnectionUri(withAuth as never)).toBe("mongodb://root:s3cr3t@mongo.internal:27017/?authSource=admin&directConnection=true");
        expect(shellConnectionUri(base as never)).toBe("mongodb://mongo.internal:27017/?directConnection=true");
    });

    it("keeps an SRV name, a seed list and a stored inline uri as the driver gets them", () => {
        expect(shellConnectionUri({ ...withAuth, host: "cluster0.ab12c.mongodb.net" } as never)).toBe("mongodb+srv://root:s3cr3t@cluster0.ab12c.mongodb.net/?authSource=admin");
        expect(shellConnectionUri({ ...withAuth, host: "rs1.example.com,rs2.example.com" } as never)).toBe("mongodb://root:s3cr3t@rs1.example.com:27017,rs2.example.com:27017/?authSource=admin");
        const uri = "mongodb://legacy:pw@mongo.internal:27017";
        expect(shellConnectionUri({ ...withAuth, uri } as never)).toBe(uri);
    });
});

describe("maskSecrets", () => {
    it("masks a password passed as its own argument", () => {
        expect(maskSecrets(["--password", "s3cr3t"], "s3cr3t")).toBe("--password ******");
    });

    it("masks a password embedded in a connection string", () => {
        const masked = maskSecrets(
            ["--uri=mongodb+srv://root:s3cr3t@cluster0.ab12c.mongodb.net/?authSource=admin"],
            "s3cr3t",
        );
        expect(masked).not.toContain("s3cr3t");
        expect(masked).toContain("root:******@cluster0.ab12c.mongodb.net");
    });

    it("masks a connection string password the caller does not know", () => {
        const masked = maskSecrets(["mongodb://legacy:storedpw@mongo.internal:27017"]);
        expect(masked).not.toContain("storedpw");
    });

    it("leaves a connection string without credentials alone", () => {
        const argv = ["--uri=mongodb+srv://cluster0.ab12c.mongodb.net/"];
        expect(maskSecrets(argv)).toBe(argv[0]);
    });
});

describe("the login mongodump and mongorestore read from the file of --config", () => {
    it("keeps the password of a single host out of the flags", () => {
        const { args, secrets } = toolConnection(withAuth as never);
        expect(args).toEqual(["--host", "mongo.internal", "--port", "27017", "--username", "root", "--authenticationDatabase", "admin"]);
        expect(secrets).toBe('password: "s3cr3t"\n');
    });

    it("puts a connection string of an SRV name or a seed list into the file whole, since it carries the login", () => {
        for (const host of ["cluster0.ab12c.mongodb.net", "a.internal:27017,b.internal:27017"]) {
            const { args, secrets } = toolConnection({ ...withAuth, host } as never);
            expect(args, host).toEqual([]);
            expect(secrets, host).toMatch(/^uri: "mongodb(\+srv)?:\/\/root:s3cr3t@/);
        }
    });

    it("escapes what YAML would read as a line break", () => {
        const { secrets } = toolConnection({ ...withAuth, password: "a\u2028b\u0085c" } as never);
        expect(secrets).toBe('password: "a\\u2028b\\u0085c"\n');
    });

    it("needs no file without a password", () => {
        expect(toolConnection(base as never)).toEqual({ args: ["--host", "mongo.internal", "--port", "27017"], secrets: null });
    });
});
