/**
 * A MongoDB connection that names one host and no SRV record talks to that host alone. Without
 * `directConnection` the driver would also contact the members the server announces, which the
 * local network check never read. A seed list or an SRV name still discovers its replica set.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const created = vi.hoisted(() => [] as { uri: string; options: Record<string, unknown> }[]);
vi.mock("mongodb", () => ({
    MongoClient: class {
        constructor(uri: string, options: Record<string, unknown>) {
            created.push({ uri, options });
        }
        async connect() {}
        db() {
            return { command: async () => ({ version: "8.0.0", ok: 1 }) };
        }
        async close() {}
    },
}));

const { DriverMongoMeta } = await import("@/lib/adapters/database/mongodb/meta/driver-meta");
const { buildConnectionArgs, connectsDirectly } = await import("@/lib/adapters/database/mongodb/args");

async function optionsFor(config: Record<string, unknown>) {
    created.length = 0;
    await new DriverMongoMeta(config as never).serverVersion();
    return created[0];
}

beforeEach(() => {
    created.length = 0;
});

describe("the MongoDB driver", () => {
    it("connects directly to a single host, plain, with a port or IPv6", async () => {
        for (const host of ["mongo.example.com", "10.0.0.5:27018", "[fd00::5]:27017", "mongodb://admin@mongo.example.com/app"]) {
            expect((await optionsFor({ host, port: 27017 })).options.directConnection, host).toBe(true);
        }
    });

    it("keeps discovering a replica set from a seed list or an SRV name, and leaves an older URI as it is", async () => {
        for (const config of [
            { host: "a.example.com:27017,b.example.com:27017" },
            { host: "mongodb+srv://cluster.example.com" },
            { host: "cluster0.ab12c.mongodb.net" },
            { host: "ignored", uri: "mongodb://a.example.com/?replicaSet=rs0" },
        ]) {
            expect((await optionsFor(config)).options.directConnection, JSON.stringify(config)).toBeUndefined();
        }
    });

    it("hands the tools a single --host as before, which they connect to directly", () => {
        const config = { host: "mongo.example.com", port: 27017, user: "u", password: "p" };
        expect(connectsDirectly(config as never)).toBe(true);
        expect(buildConnectionArgs(config as never)).toEqual(["--host", "mongo.example.com", "--port", "27017", "--username", "u", "--password", "p", "--authenticationDatabase", "admin"]);
    });
});
