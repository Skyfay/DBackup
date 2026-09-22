import { describe, it, expect } from "vitest";
import { connectionAddress, connectionSshHost, connectionVersion } from "@/components/adapter/connection-summary";

const config = (value: Record<string, unknown>) => JSON.stringify(value);

describe("connectionAddress", () => {
    it("shows host and port for a database server", () => {
        expect(connectionAddress("postgres", config({ host: "db-01.internal", port: 5432, user: "backup" }))).toBe("db-01.internal:5432");
    });

    it("adds the database index for Redis", () => {
        expect(connectionAddress("redis", config({ host: "cache-01", port: 6379 }))).toBe("cache-01:6379, DB 0");
    });

    it("shortens a long recipient list of an email channel", () => {
        const address = connectionAddress("email", config({ from: "backup@corp.io", to: ["a@corp.io", "b@corp.io", "c@corp.io", "d@corp.io"] }));

        expect(address).toBe("backup@corp.io → a@corp.io, b@corp.io +2");
    });

    it("names the bucket of every S3 flavour", () => {
        expect(connectionAddress("s3-r2", config({ bucket: "dbackup-cold" }))).toBe("dbackup-cold");
    });

    it("tells an unreadable config apart from an adapter with nothing to show", () => {
        expect(connectionAddress("postgres", "{not json")).toBeUndefined();
        expect(connectionAddress("unknown-adapter", config({}))).toBeNull();
    });
});

describe("connectionSshHost and connectionVersion", () => {
    it("names the jump host only for a connection that goes through SSH", () => {
        expect(connectionSshHost(config({ connectionMode: "ssh", sshHost: "bastion-01" }))).toBe("bastion-01");
        expect(connectionSshHost(config({ connectionMode: "direct", sshHost: "bastion-01" }))).toBeNull();
    });

    it("reads the server version from the metadata of the last version check", () => {
        expect(connectionVersion(config({ engineVersion: "16.4" }))).toBe("16.4");
        expect(connectionVersion(undefined)).toBeNull();
    });
});
