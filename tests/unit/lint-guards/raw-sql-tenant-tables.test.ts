// @vitest-environment node
/**
 * Raw SQL skips the tenant filter of the Prisma extension. A query that names a table of a tenant
 * model or of a row hanging off one may only find ids or numbers of rows the caller already read
 * through the client, which filters again, see "Raw SQL Skips the Filter" in the guide of the
 * tenants. Each file that does so was read for that and is listed here, so a new one is read too.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHILD_MODELS, TENANT_MODELS } from "@/lib/tenant/prisma-scope";

const SRC = path.resolve(__dirname, "../../../src");

/** The files whose raw SQL names a tenant table, each read for what it hands back. */
const REVIEWED: Record<string, string> = {
    "services/history/newest-runs.ts": "ids of runs of the jobs the caller read through the client, and numbers",
    "services/tenant/tenant-summaries.ts": "the length of the lists of the servers the client found",
    "services/dashboard/aggregates.ts": "ids of snapshots, read again through the client and named by tenant",
    "services/adapters/connection-health.ts": "numbers of the health checks of the connections the client found",
    // The copy of the whole instance a configuration backup uploads or restores, a platform admin's alone.
    "services/config/copy-rekey.ts": "re-encrypts every table of a copy of the instance",
    "services/config/copy-inspect.ts": "checks a copy of the instance before its restore",
    "services/config/restore-staging.ts": "prepares a copy of the instance for its restore",
};

const TABLES = [...TENANT_MODELS, ...Object.keys(CHILD_MODELS)];

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
}

/** The text of every raw query and SQL fragment of a file, up to its first nested template. */
function sqlOf(code: string): string[] {
    const pattern = /(?:\$(?:queryRaw|executeRaw)(?:Unsafe)?(?:<[^`(]*?>)?\s*(?:\(\s*)?|Prisma\.sql\s*)`([^`]*)`/g;
    return [...code.matchAll(pattern)].map((match) => match[1]);
}

function tenantTablesOf(file: string): string[] {
    const sql = sqlOf(fs.readFileSync(file, "utf8")).join("\n");
    return TABLES.filter((table) => new RegExp(`(^|[^A-Za-z_])"?${table}"?($|[^A-Za-z_])`).test(sql));
}

describe("raw SQL", () => {
    const naming = sourceFiles(SRC)
        .map((file) => ({ file: path.relative(SRC, file), tables: tenantTablesOf(file) }))
        .filter((entry) => entry.tables.length > 0);

    it("names a table of a tenant only in a file read for what it hands back", () => {
        const unread = naming.filter((entry) => !(entry.file in REVIEWED)).map((entry) => `${entry.file}: ${entry.tables.join(", ")}`);
        expect(unread, "Select ids or numbers only and read the rows through the client, then list the file in REVIEWED").toEqual([]);
    });

    it("keeps the list of read files to those that still need it", () => {
        const stale = Object.keys(REVIEWED).filter((file) => !naming.some((entry) => entry.file === file));
        expect(stale, "Drop the file from REVIEWED").toEqual([]);
    });

    it("says in each file of the app's client why it is raw SQL", () => {
        const silent = Object.keys(REVIEWED)
            .filter((file) => !file.startsWith("services/config/"))
            .filter((file) => !/Raw SQL for/.test(fs.readFileSync(path.join(SRC, file), "utf8")));
        expect(silent, "Leave a comment that starts with Raw SQL for and the measured reason").toEqual([]);
    });
});
