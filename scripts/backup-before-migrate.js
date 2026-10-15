#!/usr/bin/env node
/**
 * Keeps a copy of the database before `prisma migrate deploy` changes it.
 *
 * A migration of a new version can not be undone, so a start that is about to apply one first
 * writes the database as it is to dbackup.db.before-migrate-<time> beside it. Going back to the
 * older version then means stopping DBackup and putting that copy in place. A start without a
 * pending migration copies nothing, and only the newest copies are kept.
 *
 * Runs in docker-entrypoint.sh and in `pnpm dev`, after a configuration restore was swapped in.
 * Plain Node without dependencies, like apply-pending-restore.js.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const { databaseFile } = require("./apply-pending-restore.js");

const PREFIX = ".before-migrate-";
const KEEP = 3;

/** The migrations this version ships, by folder name like Prisma records them. */
function shippedMigrations() {
    const dir = path.join(process.cwd(), "prisma", "migrations");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** The older copies beyond the newest few, which would otherwise fill the volume one update at a time. */
function prune(live) {
    const folder = path.dirname(live);
    const start = `${path.basename(live)}${PREFIX}`;
    const copies = fs.readdirSync(folder).filter((name) => name.startsWith(start)).sort();
    for (const name of copies.slice(0, Math.max(0, copies.length - KEEP))) {
        fs.rmSync(path.join(folder, name), { force: true });
    }
}

function main() {
    const live = databaseFile();
    if (!live || !fs.existsSync(live)) return;

    // Loaded here, so a Node without it fails this backup and not the start.
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(live);
    try {
        let applied;
        try {
            applied = new Set(db.prepare("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL").all().map((row) => row.migration_name));
        } catch {
            // A database without the table of Prisma holds nothing a migration could lose.
            return;
        }
        const pending = shippedMigrations().filter((name) => !applied.has(name));
        if (pending.length === 0) return;

        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const copy = `${live}${PREFIX}${stamp}`;
        // A consistent copy that includes what still waits in the write-ahead log.
        db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
        console.log(`Kept the database before ${pending.length} migration(s) as ${path.basename(copy)} in ${path.dirname(copy)}.`);
    } finally {
        db.close();
    }
    prune(live);
}

try {
    main();
} catch (error) {
    // The migrations still run. Refusing to start over a failed copy would leave nothing to fix it with.
    console.error(`The database could not be copied before the migrations: ${error.message}`);
}
