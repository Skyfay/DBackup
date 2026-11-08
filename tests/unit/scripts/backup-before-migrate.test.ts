// @vitest-environment node
/**
 * The copy of the database before `prisma migrate deploy`, run as the start of the image runs it:
 * a plain Node process in the folder of the app, with the migrations of the app beside it.
 */
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts", "backup-before-migrate.js");

let dir = "";
const live = () => path.join(dir, "data", "dbackup.db");
const copies = () => readdirSync(path.join(dir, "data")).filter((name) => name.includes(".before-migrate-")).sort();
const run = () => execFileSync(process.execPath, [SCRIPT], { env: { ...process.env, DATABASE_URL: `file:${live()}` }, cwd: dir, encoding: "utf8" });

/** The migrations the version ships, as folders under prisma/migrations of the app. */
function ship(...names: string[]) {
    for (const name of names) mkdirSync(path.join(dir, "prisma", "migrations", name), { recursive: true });
}

/** A database whose Prisma table says which migrations finished, failed or were rolled back. */
function database(rows: { name: string; finished?: boolean; rolledBack?: boolean }[]) {
    const db = new DatabaseSync(live());
    db.exec("CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY, migration_name TEXT NOT NULL, finished_at DATETIME, rolled_back_at DATETIME)");
    const insert = db.prepare("INSERT INTO _prisma_migrations (id, migration_name, finished_at, rolled_back_at) VALUES (?, ?, ?, ?)");
    for (const row of rows) insert.run(row.name, row.name, row.finished === false ? null : "2026-10-01", row.rolledBack ? "2026-10-01" : null);
    db.close();
}

beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "dbackup-before-migrate-"));
    mkdirSync(path.join(dir, "data"));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe("the copy of the database before the migrations of an update", () => {
    it("is kept when the update brings a migration the database does not have yet", () => {
        ship("001_base", "002_tenants");
        database([{ name: "001_base" }]);

        expect(run()).toContain("Kept the database before 1 migration(s)");
        expect(copies()).toHaveLength(1);
    });

    it("is not made on a start without a pending migration", () => {
        ship("001_base");
        database([{ name: "001_base" }]);

        run();
        expect(copies()).toEqual([]);
    });

    it("is not made again while a migration that started never finished, so restarts never prune the clean copy", () => {
        ship("001_base", "002_tenants");
        database([{ name: "001_base" }]);
        run();
        const clean = copies();

        // The migration failed half way, and the container restarts again and again.
        const db = new DatabaseSync(live());
        db.prepare("INSERT INTO _prisma_migrations (id, migration_name, finished_at, rolled_back_at) VALUES ('002', '002_tenants', NULL, NULL)").run();
        db.close();
        for (let start = 0; start < 5; start++) expect(run()).toContain("A migration did not finish (002_tenants)");

        expect(copies()).toEqual(clean);
    });

    it("is made again once a failed migration was marked as rolled back to retry it", () => {
        ship("001_base", "002_tenants");
        database([{ name: "001_base" }, { name: "002_tenants", finished: false, rolledBack: true }]);

        expect(run()).toContain("Kept the database before 1 migration(s)");
    });

    it("keeps the three newest copies of earlier updates", () => {
        ship("001_base", "002_tenants");
        database([{ name: "001_base" }]);
        for (const stamp of ["2026-01-01", "2026-02-01", "2026-03-01"]) writeFileSync(`${live()}.before-migrate-${stamp}T00-00-00-000Z`, "old");

        run();

        expect(copies()).toHaveLength(3);
        expect(copies()[0]).toContain("2026-02-01");
    });

    it("leaves a database without the table of Prisma alone", () => {
        ship("001_base");
        new DatabaseSync(live()).close();

        run();
        expect(copies()).toEqual([]);
    });
});
