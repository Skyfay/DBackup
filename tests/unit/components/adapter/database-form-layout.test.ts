import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getAdapterDefinition, type AdapterDefinition } from "@/lib/adapters/definitions";
import { LOGIN_KEY, SSH_LOGIN_KEY } from "@/components/adapter/connection-form-layout";
import { databaseLayout } from "@/components/adapter/database-form-layout";

function adapter(id: string): AdapterDefinition {
    const definition = getAdapterDefinition(id);
    if (!definition) throw new Error(`No adapter ${id}`);
    return definition;
}

const ids = (id: string, config: Record<string, unknown>) => databaseLayout(adapter(id), config).map((section) => section.id);

describe("database form parts", () => {
    it("shows only what does not depend on the mode until one is picked", () => {
        expect(ids("mysql", {})).toEqual(["connection", "options", "behavior"]);
    });

    it("keeps host, port and login in the first part for a direct connection", () => {
        const [connection] = databaseLayout(adapter("postgres"), { connectionMode: "direct" });
        expect(connection.keys).toEqual(expect.arrayContaining(["host", "port", LOGIN_KEY]));
        // PostgreSQL needs a user, which only a login profile can bring.
        expect(connection.expects).toContain(LOGIN_KEY);
    });

    it("splits an SSH connection into the SSH server and the database behind it", () => {
        const layout = databaseLayout(adapter("mysql"), { connectionMode: "ssh" });
        expect(layout.map((section) => section.id)).toEqual(["connection", "ssh", "database", "options", "behavior"]);
        expect(layout[1].expects).toEqual(["sshHost", SSH_LOGIN_KEY]);
        expect(layout[0].keys).not.toContain("host");
    });

    it("does not expect a login where the database can run without one", () => {
        const [connection] = databaseLayout(adapter("mongodb"), { connectionMode: "direct" });
        expect(connection.keys).toContain(LOGIN_KEY);
        expect(connection.expects).not.toContain(LOGIN_KEY);
    });

    it("asks SQL Server how the backup file travels only on a direct connection", () => {
        expect(ids("mssql", { connectionMode: "direct" })).toContain("transfer");
        const overSsh = databaseLayout(adapter("mssql"), { connectionMode: "ssh" });
        expect(overSsh.map((section) => section.id)).not.toContain("transfer");
        expect(overSsh.find((section) => section.id === "options")?.keys).toContain("backupPath");
    });

    it("expects the local folder or the SSH login, depending on how the file travels", () => {
        const transfer = (fileTransferMode: string) =>
            databaseLayout(adapter("mssql"), { connectionMode: "direct", fileTransferMode }).find((section) => section.id === "transfer");
        expect(transfer("local")?.expects).toContain("localBackupPath");
        expect(transfer("ssh")?.expects).toContain(SSH_LOGIN_KEY);
    });

    it("gives Azure SQL, which has no SSH mode, the connection fields right away", () => {
        const [connection] = databaseLayout(adapter("azure-sql"), {});
        expect(connection.keys).toEqual(expect.arrayContaining(["host", "port"]));
    });

    it("lists the Firebird aliases as a part of their own that needs at least one entry", () => {
        const aliases = databaseLayout(adapter("firebird"), { connectionMode: "direct" }).find((section) => section.id === "aliases");
        expect(aliases?.expects).toEqual(["databases"]);
    });

    it("keeps the SQLite file in the first part locally and on its own part over SSH", () => {
        expect(databaseLayout(adapter("sqlite"), { mode: "local" })[0].keys).toContain("path");
        expect(ids("sqlite", { mode: "ssh" })).toEqual(["connection", "ssh", "file", "behavior"]);
    });

    it("shows the Sentinel fields only for a Sentinel setup", () => {
        const options = (mode: string) =>
            databaseLayout(adapter("redis"), { connectionMode: "direct", mode }).find((section) => section.id === "options")?.keys;
        expect(options("standalone")).not.toContain("sentinelNodes");
        expect(options("sentinel")).toEqual(expect.arrayContaining(["sentinelMasterName", "sentinelNodes"]));
    });

    it("puts a field that no list names into Options, so a new setting never goes missing", () => {
        const postgres = adapter("postgres");
        const extended = { ...postgres, configSchema: postgres.configSchema.extend({ statementTimeout: z.coerce.number().optional() }) };
        const options = databaseLayout(extended, { connectionMode: "direct" }).find((section) => section.id === "options")?.keys;
        expect(options).toContain("statementTimeout");
        // The databases a job backs up are picked in the job, never here.
        expect(options).not.toContain("database");
    });
});
