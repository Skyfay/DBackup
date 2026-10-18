// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import { DIALED_HOSTS, dialedHosts, hostOf, hostsIn, urlHost } from "@/lib/adapters/dialed-hosts";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";

registerAdapters();

describe("the hosts DBackup dials for a connection", () => {
    it("has an entry for every adapter, so a new one is never left unchecked", () => {
        const ids = new Set([...ADAPTER_DEFINITIONS.map((definition) => definition.id), ...registry.getAll().map((adapter) => adapter.id)]);
        const missing = [...ids].filter((id) => !Object.hasOwn(DIALED_HOSTS, id));
        expect(missing, "Add these adapters to DIALED_HOSTS in src/lib/adapters/dialed-hosts.ts").toEqual([]);
    });

    it("dials the host of a database in direct mode and the SSH host alone in SSH mode", () => {
        for (const adapterId of ["mysql", "mariadb", "postgres", "mongodb", "firebird", "redis", "valkey"]) {
            expect(dialedHosts(adapterId, { host: "10.0.0.5", port: 5432 }), adapterId).toEqual(["10.0.0.5"]);
            expect(dialedHosts(adapterId, { host: "127.0.0.1", connectionMode: "ssh", sshHost: "jump.example.com" }), adapterId).toEqual(["jump.example.com"]);
        }
        expect(dialedHosts("azure-sql", { host: "acme.database.windows.net" })).toEqual(["acme.database.windows.net"]);
    });

    it("dials every host of a field that lists several", () => {
        expect(dialedHosts("postgres", { host: "db1.internal,db2.internal" })).toEqual(["db1.internal", "db2.internal"]);
        expect(dialedHosts("redis", { mode: "sentinel", host: "cache", sentinelNodes: "10.0.0.1:26379, [fd00::2]:26379" })).toEqual(["cache", "10.0.0.1", "fd00::2"]);
        expect(dialedHosts("redis", { mode: "standalone", host: "cache", sentinelNodes: "10.0.0.1:26379" })).toEqual(["cache"]);
        expect(dialedHosts("mongodb", { host: "db", uri: "mongodb://user:pw@10.0.0.1:27017,10.0.0.2/app?tls=true" })).toEqual(["db", "10.0.0.1", "10.0.0.2"]);
    });

    it("dials SQLite only over SSH, where its SSH host sits in host", () => {
        expect(dialedHosts("sqlite", { mode: "local", path: "/data/app.db" })).toEqual([]);
        expect(dialedHosts("sqlite", { mode: "ssh", host: "files.example.com", path: "/srv/app.db" })).toEqual(["files.example.com"]);
    });

    it("dials SQL Server through its SSH host, which falls back to the database host, and both for the older file transfer", () => {
        expect(dialedHosts("mssql", { host: "sql.internal", connectionMode: "ssh", sshHost: "jump" })).toEqual(["jump"]);
        expect(dialedHosts("mssql", { host: "sql.internal", connectionMode: "ssh" })).toEqual(["sql.internal"]);
        expect(dialedHosts("mssql", { host: "sql.internal", fileTransferMode: "ssh", sshUsername: "backup", sshHost: "files" })).toEqual(["sql.internal", "files"]);
        expect(dialedHosts("mssql", { host: "sql.internal", fileTransferMode: "local" })).toEqual(["sql.internal"]);
    });

    it("dials Docker only over SSH, its socket is the server's own", () => {
        expect(dialedHosts("docker-volume", { socketPath: "/var/run/docker.sock" })).toEqual([]);
        expect(dialedHosts("docker-volume", { connectionMode: "ssh", sshHost: "docker.example.com" })).toEqual(["docker.example.com"]);
    });

    it("dials the server of every network storage", () => {
        expect(dialedHosts("sftp", { host: "nas.internal", port: 22 })).toEqual(["nas.internal"]);
        expect(dialedHosts("ftp", { host: "192.168.1.5" })).toEqual(["192.168.1.5"]);
        expect(dialedHosts("rsync", { host: "backup.example.com" })).toEqual(["backup.example.com"]);
        expect(dialedHosts("smb", { address: "//fileserver/backups/sub" })).toEqual(["fileserver"]);
        expect(dialedHosts("smb", { address: "\\\\10.0.0.9\\share" })).toEqual(["10.0.0.9"]);
        expect(dialedHosts("webdav", { url: "https://cloud.example.com/remote.php/dav/files/me/" })).toEqual(["cloud.example.com"]);
        expect(dialedHosts("webdav", { url: "http://[fd00::1]:8080/dav" })).toEqual(["fd00::1"]);
    });

    it("dials an S3 endpoint and the host of the bucket on it, unless the bucket goes in the path", () => {
        expect(dialedHosts("s3-generic", { endpoint: "https://s3.example.com", bucket: "backups" })).toEqual(["s3.example.com", "backups.s3.example.com"]);
        expect(dialedHosts("s3-generic", { endpoint: "http://10.0.0.7:9000", bucket: "backups", forcePathStyle: true })).toEqual(["10.0.0.7"]);
        expect(dialedHosts("s3-generic", { endpoint: "minio.internal:9000", bucket: "Backups_2026", forcePathStyle: false })).toEqual(["minio.internal"]);
        expect(dialedHosts("s3-r2", { accountId: "abc123", bucket: "vault" })).toEqual(["abc123.r2.cloudflarestorage.com", "vault.abc123.r2.cloudflarestorage.com"]);
        expect(dialedHosts("s3-hetzner", { region: "fsn1", bucket: "vault" })).toEqual(["fsn1.your-objectstorage.com", "vault.fsn1.your-objectstorage.com"]);
    });

    it("sees through an account id or a region that would put another host into the endpoint", () => {
        expect(dialedHosts("s3-r2", { accountId: "10.0.0.5/x?", bucket: "b" })[0]).toBe("10.0.0.5");
        expect(dialedHosts("s3-hetzner", { region: "10.0.0.5#", bucket: "b" })[0]).toBe("10.0.0.5");
    });

    it("dials nothing for fixed public endpoints and for what reaches the server itself", () => {
        for (const adapterId of ["s3-aws", "google-drive", "dropbox", "onedrive", "telegram", "twilio-sms", "local-filesystem"]) {
            expect(dialedHosts(adapterId, { host: "10.0.0.5", url: "http://10.0.0.5", endpoint: "http://10.0.0.5" }), adapterId).toEqual([]);
        }
    });

    it("dials every URL or host a person types into a channel", () => {
        for (const adapterId of ["discord", "slack", "teams", "generic-webhook"]) {
            expect(dialedHosts(adapterId, { webhookUrl: "http://192.168.0.10/hook" }), adapterId).toEqual(["192.168.0.10"]);
        }
        expect(dialedHosts("gotify", { serverUrl: "http://gotify.lan" })).toEqual(["gotify.lan"]);
        expect(dialedHosts("ntfy", { serverUrl: "https://ntfy.sh", topic: "t" })).toEqual(["ntfy.sh"]);
        expect(dialedHosts("email", { host: "smtp.internal", port: 587 })).toEqual(["smtp.internal"]);
    });

    it("dials the SSH host or the host of an id without an entry, like an SSH test that names no adapter", () => {
        expect(dialedHosts("ssh", { connectionMode: "ssh", sshHost: "10.0.0.3" })).toEqual(["10.0.0.3"]);
        expect(dialedHosts("future-adapter", { host: "10.0.0.4" })).toEqual(["10.0.0.4"]);
    });
});

describe("a host as a field names it", () => {
    it("reads a name, an address, a port, brackets and a URL, and leaves a socket path out", () => {
        expect(hostOf("db.internal")).toBe("db.internal");
        expect(hostOf(" db.internal:5432 ")).toBe("db.internal");
        expect(hostOf("fd00::5")).toBe("fd00::5");
        expect(hostOf("[fd00::5]:5432")).toBe("fd00::5");
        expect(hostOf("tcp://10.0.0.1:2375")).toBe("10.0.0.1");
        expect(hostOf("/var/run/postgresql")).toBeNull();
        expect(hostOf("")).toBeNull();
        expect(hostOf(undefined)).toBeNull();
        expect(hostsIn("a, b,,c:1")).toEqual(["a", "b", "c"]);
    });

    it("reads the host of a URL with or without its scheme", () => {
        expect(urlHost("https://hooks.slack.com/services/x")).toBe("hooks.slack.com");
        expect(urlHost("s3.example.com")).toBe("s3.example.com");
        expect(urlHost("http://2130706433/")).toBe("127.0.0.1");
        expect(urlHost("")).toBeNull();
        expect(urlHost(42)).toBeNull();
    });
});
