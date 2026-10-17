import { describe, expect, it } from "vitest";
import { hostLocalReason, isAlwaysHostLocal } from "@/lib/adapters/host-local";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";

const reaches = (adapterId: string, config: Record<string, unknown>) => hostLocalReason(adapterId, config) !== null;

describe("connections that reach the server DBackup runs on", () => {
    it("counts Local Filesystem in any folder, and says who adds one", () => {
        expect(hostLocalReason("local-filesystem", { basePath: "/" })).toBe("Local Filesystem reaches the server DBackup runs on, which only the platform adds.");
        expect(reaches("local-filesystem", { basePath: "/backups" })).toBe(true);
        expect(isAlwaysHostLocal("local-filesystem")).toBe(true);
    });

    it("counts Docker Volumes through the socket of the server, not through the Docker of another host over SSH", () => {
        expect(reaches("docker-volume", {})).toBe(true);
        expect(reaches("docker-volume", { connectionMode: "direct", socketPath: "/var/run/docker.sock" })).toBe(true);
        expect(reaches("docker-volume", { connectionMode: "ssh", sshHost: "docker.customer", sshUsername: "backup", sshAuthType: "password" })).toBe(false);
        expect(isAlwaysHostLocal("docker-volume")).toBe(false);
    });

    it("counts SQLite in local mode, which would open the database of DBackup itself, but not a file reached over SSH", () => {
        expect(hostLocalReason("sqlite", { mode: "local", path: "/app/data/dbackup.db" })).toContain("reads a file on the server DBackup runs on");
        expect(reaches("sqlite", { path: "/app/data/dbackup.db" })).toBe(true);
        expect(reaches("sqlite", { mode: "ssh", host: "db.customer", username: "backup", authType: "password", path: "/srv/app.db" })).toBe(false);
        expect(isAlwaysHostLocal("sqlite")).toBe(false);
    });

    it("counts the additional options of dump tools that run on the server in direct mode, which can name any file there", () => {
        expect(hostLocalReason("postgres", { host: "db.customer", options: "-f /app/data/dbackup.db" })).toContain("The additional options of PostgreSQL run its tools");
        expect(reaches("mysql", { host: "db.customer", options: "--result-file=/app/data/dbackup.db" })).toBe(true);
        expect(reaches("mariadb", { host: "db.customer", connectionMode: "direct", options: "--skip-lock-tables" })).toBe(true);
        expect(reaches("mongodb", { host: "db.customer", options: "--out=/app" })).toBe(true);
        expect(reaches("firebird", { host: "db.customer", options: "-y /app/log" })).toBe(true);
        // Over SSH the tools run on the server of the customer, and empty options are none.
        expect(reaches("postgres", { host: "localhost", connectionMode: "ssh", sshAuthType: "password", options: "-f /tmp/x" })).toBe(false);
        expect(reaches("postgres", { host: "db.customer", options: "  " })).toBe(false);
        // SQL Server and Redis store the field and never hand it to a tool.
        expect(reaches("mssql", { host: "db.customer", options: "COMPRESSION" })).toBe(false);
        expect(reaches("redis", { host: "cache.customer", options: "--rdb /tmp/x" })).toBe(false);
    });

    it("counts a database reached through a socket path or MongoDB through a connection URI in direct mode", () => {
        expect(reaches("postgres", { host: "/var/run/postgresql" })).toBe(true);
        expect(reaches("mongodb", { host: "db.customer", uri: "mongodb://db.customer/?tlsCAFile=/proc/self/environ" })).toBe(true);
        expect(reaches("mongodb", { connectionMode: "ssh", sshAuthType: "password", uri: "mongodb://localhost" })).toBe(false);
    });

    it("leaves a database on a server of its own alone", () => {
        for (const adapterId of ["mysql", "mariadb", "postgres", "mongodb", "mssql", "azure-sql", "redis", "valkey", "firebird"]) {
            expect(reaches(adapterId, { host: "db.customer", port: 1234, user: "backup" })).toBe(false);
        }
    });

    it("judges SQL Server staging its backup files through a local folder harmless, it only reads a name it made up", () => {
        expect(reaches("mssql", { host: "db.customer", fileTransferMode: "local", localBackupPath: "/" })).toBe(false);
    });

    it("counts rsync options that name a command or a file, but not those that only tune the transfer", () => {
        const login = { host: "nas.customer", authType: "password", password: "pw" };
        expect(hostLocalReason("rsync", { ...login, options: "-e sh" })).toBe("The rsync option -e reaches the server DBackup runs on, which only the platform sets.");
        expect(reaches("rsync", { ...login, options: "/proc/self/environ" })).toBe(true);
        expect(reaches("rsync", { ...login, options: "--log-file=/app/x" })).toBe(true);
        expect(reaches("rsync", { ...login, options: "-avze" })).toBe(true);
        expect(reaches("rsync", { ...login, options: "-z --bwlimit=1.5m --timeout=30 -P --no-perms" })).toBe(false);
        expect(reaches("rsync", { ...login, options: "-avz" })).toBe(false);
    });

    it("counts rsync without a login of its own, which uses the SSH keys of the server", () => {
        expect(reaches("rsync", { host: "nas.customer", authType: "agent" })).toBe(true);
        expect(reaches("rsync", { host: "nas.customer", authType: "privateKey" })).toBe(true);
        expect(reaches("rsync", { host: "nas.customer" })).toBe(true);
        expect(reaches("rsync", { host: "nas.customer", authType: "privateKey", privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----" })).toBe(false);
    });

    it("counts an SSH login through the agent of the server, wherever the SSH fields sit", () => {
        expect(reaches("postgres", { host: "localhost", connectionMode: "ssh", sshAuthType: "agent" })).toBe(true);
        expect(reaches("docker-volume", { connectionMode: "ssh", sshAuthType: "agent" })).toBe(true);
        expect(reaches("sqlite", { mode: "ssh", authType: "agent", path: "/srv/app.db" })).toBe(true);
        // A leftover agent choice of a mode that is not used reaches nothing.
        expect(reaches("postgres", { host: "db.customer", connectionMode: "direct", sshAuthType: "agent" })).toBe(false);
    });

    it("leaves every network storage and notification channel alone", () => {
        expect(reaches("s3-aws", { region: "eu-central-1", bucket: "backups" })).toBe(false);
        expect(reaches("sftp", { host: "nas.customer", username: "backup", authType: "password" })).toBe(false);
        expect(reaches("smb", { address: "//nas/share" })).toBe(false);
        expect(reaches("discord", { webhookUrl: "https://discord.example/hook" })).toBe(false);
    });

    it("hides only adapters that reach the server in every mode", () => {
        const always = ADAPTER_DEFINITIONS.filter((definition) => isAlwaysHostLocal(definition.id)).map((definition) => definition.id);
        expect(always).toEqual(["local-filesystem"]);
    });
});
