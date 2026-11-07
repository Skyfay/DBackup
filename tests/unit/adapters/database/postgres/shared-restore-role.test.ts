import { describe, it, expect } from "vitest";

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { restoreOne } from "@/lib/adapters/database/postgres/restore";
import { sqlLiteral } from "@/lib/adapters/database/postgres/args";
import type { HostKind } from "@/lib/transport/types";

/**
 * A customer's restore of a shared PostgreSQL database runs pg_restore as the owner of the
 * database, so the customer's functions never come to belong to the provider's login.
 */

const provider = {
    host: "db.internal",
    port: 5432,
    user: "provider_admin",
    password: "secret",
    database: "postgres",
};

/** The SQL passed after -c, if any. */
function queryOf(argv: string[]): string | undefined {
    const i = argv.indexOf("-c");
    return i === -1 ? undefined : argv[i + 1];
}

/** A server whose owner lookup answers `ownerRow` and whose pg_restore answers `restore`. */
function server(kind: HostKind, ownerRow: { code?: number; stdout?: string; stderr?: string }, restore: { code?: number; stderr?: string } = {}): FakeHost {
    return createFakeHost({
        kind,
        onExec: (argv) => {
            if (argv[0] === "psql" && queryOf(argv)?.includes("pg_database")) return ownerRow;
            if (argv[0] === "pg_restore") return restore;
            return undefined;
        },
    });
}

const restoreCall = (host: FakeHost) => host.calls.exec.find((argv) => argv[0] === "pg_restore");
const lookupCall = (host: FakeHost) => host.calls.exec.find((argv) => argv[0] === "psql" && queryOf(argv)?.includes("pg_database"));

describe.each<HostKind>(["direct", "ssh"])("A customer's restore of a shared PostgreSQL database over a %s host", (kind) => {
    it("runs pg_restore as the owner of the database when the owner is another role than the login", async () => {
        const host = server(kind, { stdout: "f|f|shop_acme_owner\n" });

        await restoreOne({ ...provider, sharedRestore: true } as never, "/tmp/a.dump", "shop_acme", host);

        const argv = restoreCall(host)!;
        expect(argv).toContain("--role=shop_acme_owner");
        expect(argv).toContain("--no-owner");
        // The lookup happens before the restore, against the target database.
        expect(host.calls.exec.indexOf(lookupCall(host)!)).toBeLessThan(host.calls.exec.indexOf(argv));
        expect(lookupCall(host)![lookupCall(host)!.indexOf("-d") + 1]).toBe("dbname='shop_acme'");
    });

    it("keeps a role name with a pipe in it whole", async () => {
        const host = server(kind, { stdout: "f|f|odd|name\n" });

        await restoreOne({ ...provider, sharedRestore: true } as never, "/tmp/a.dump", "shop", host);

        expect(restoreCall(host)).toContain("--role=odd|name");
    });

    it("restores as the login, without a role, when the login owns the database", async () => {
        const host = server(kind, { stdout: "t|f|provider_admin\n" });

        await restoreOne({ ...provider, sharedRestore: true } as never, "/tmp/a.dump", "shop_acme", host);

        const argv = restoreCall(host)!;
        expect(argv).toBeDefined();
        expect(argv.some((arg) => arg.startsWith("--role"))).toBe(false);
    });

    it("stops before pg_restore when the owner cannot be read", async () => {
        const host = server(kind, { code: 2, stderr: "connection refused" });

        await expect(restoreOne({ ...provider, sharedRestore: true } as never, "/tmp/a.dump", "shop_acme", host))
            .rejects.toThrow(/Could not read the owner of database 'shop_acme'/);
        expect(restoreCall(host)).toBeUndefined();
    });

    it("stops before pg_restore when the database is not found", async () => {
        const host = server(kind, { stdout: "" });

        await expect(restoreOne({ ...provider, sharedRestore: true } as never, "/tmp/a.dump", "gone", host)).rejects.toThrow(/Could not read the owner/);
        expect(restoreCall(host)).toBeUndefined();
    });

    it("explains a login that may not act as the owner", async () => {
        const host = server(kind, { stdout: "f|f|shop_acme_owner\n" }, { code: 1, stderr: 'pg_restore: error: could not execute query: ERROR:  permission denied to set role "shop_acme_owner"' });

        await expect(restoreOne({ ...provider, sharedRestore: true } as never, "/tmp/a.dump", "shop_acme", host))
            .rejects.toThrow(/may not act as the owner 'shop_acme_owner'/);
    });

    it("leaves a restore that is not shared as it was, without a lookup and without a role", async () => {
        const host = server(kind, { stdout: "f|f|shop_acme_owner\n" });

        await restoreOne(provider as never, "/tmp/a.dump", "shop_acme", host);

        expect(lookupCall(host)).toBeUndefined();
        expect(restoreCall(host)!.some((arg) => arg.startsWith("--role"))).toBe(false);
    });

    it("quotes the database name as a literal in the owner lookup", async () => {
        const host = server(kind, { stdout: "f|f|owner\n" });
        const name = "x' OR '1'='1\\";

        await restoreOne({ ...provider, sharedRestore: true } as never, "/tmp/a.dump", name, host);

        const query = queryOf(lookupCall(host)!)!;
        expect(query).toContain("WHERE d.datname = E'x'' OR ''1''=''1\\\\'");
        expect(query.endsWith(sqlLiteral(name))).toBe(true);
    });

    it("keeps the password out of argv", async () => {
        const host = server(kind, { stdout: "f|f|owner\n" });

        await restoreOne({ ...provider, sharedRestore: true } as never, "/tmp/a.dump", "shop", host);

        expect(host.calls.exec.flat().join(" ")).not.toContain("secret");
    });
});

describe("An SQL literal for PostgreSQL", () => {
    it("doubles quotes and backslashes inside an escape string", () => {
        expect(sqlLiteral("plain")).toBe("E'plain'");
        expect(sqlLiteral("it's")).toBe("E'it''s'");
        expect(sqlLiteral("a\\b")).toBe("E'a\\\\b'");
    });
});
