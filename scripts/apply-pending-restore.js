#!/usr/bin/env node
/**
 * Swaps in a configuration restore before DBackup starts.
 *
 * A restore lays the copy of the database it restores beside the live one as restore-pending.db
 * and ends DBackup. This runs before `prisma migrate deploy`, in docker-entrypoint.sh and in
 * `pnpm dev`: the live database moves aside as dbackup.db.before-restore together with its
 * write-ahead log, the copy takes its place, and the migrations then bring an older copy up to
 * date. See src/services/config/restore-staging.ts.
 *
 * Plain Node without dependencies, since it runs before anything of DBackup is loaded.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const PENDING = "restore-pending.db";
// The files SQLite keeps beside a database. The write-ahead log belongs to its database and moves with it.
const SUFFIXES = ["", "-wal", "-shm", "-journal"];

/** DATABASE_URL from the environment, or from the .env of `pnpm dev`, which Node does not read by itself. */
function databaseUrl() {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    try {
        const line = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split(/\r?\n/).find((entry) => entry.startsWith("DATABASE_URL="));
        if (line) return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
    } catch {
        // No .env, the default below applies.
    }
    return "file:./dev.db";
}

/** The database file, a relative one against the folder of schema.prisma, as Prisma resolves it. */
function databaseFile() {
    const url = databaseUrl();
    if (!url.startsWith("file:")) return null;
    const file = url.slice("file:".length).split("?")[0];
    return path.isAbsolute(file) ? file : path.resolve(process.cwd(), "prisma", file);
}

function main() {
    const live = databaseFile();
    if (!live) return;
    const pending = path.join(path.dirname(live), PENDING);
    if (!fs.existsSync(pending)) return;

    const aside = `${live}.before-restore`;
    const moved = [];
    try {
        for (const suffix of SUFFIXES) fs.rmSync(`${aside}${suffix}`, { force: true });
        for (const suffix of SUFFIXES) {
            if (!fs.existsSync(`${live}${suffix}`)) continue;
            fs.renameSync(`${live}${suffix}`, `${aside}${suffix}`);
            moved.push(suffix);
        }
        fs.renameSync(pending, live);
        console.log(`Configuration restore applied. The database before it is ${path.basename(aside)} in ${path.dirname(live)}.`);
    } catch (error) {
        // Puts back what moved, so DBackup starts with the database it had, and keeps the copy
        // under another name so the next start does not try again.
        for (const suffix of moved) {
            try {
                fs.renameSync(`${aside}${suffix}`, `${live}${suffix}`);
            } catch {
                // Reported below with the rest.
            }
        }
        try {
            fs.renameSync(pending, path.join(path.dirname(live), `restore-failed-${Date.now()}.db`));
        } catch {
            // The copy stays where it was.
        }
        console.error(`Configuration restore could not be applied, DBackup starts with the database it had: ${error.message}`);
    }
}

main();
