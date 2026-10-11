// @vitest-environment node
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts", "apply-pending-restore.js");

let dir = "";
const file = (name: string) => path.join(dir, name);
const run = (url = `file:${file("dbackup.db")}`) => execFileSync(process.execPath, [SCRIPT], { env: { ...process.env, DATABASE_URL: url }, cwd: dir, encoding: "utf8" });

beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "dbackup-swap-"));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe("the swap of a configuration restore before DBackup starts", () => {
    it("moves the database with its write-ahead log aside and puts the restored copy in its place", () => {
        writeFileSync(file("dbackup.db"), "live");
        writeFileSync(file("dbackup.db-wal"), "wal of live");
        writeFileSync(file("dbackup.db-shm"), "shm of live");
        writeFileSync(file("restore-pending.db"), "restored");

        expect(run()).toContain("Configuration restore applied");

        expect(readFileSync(file("dbackup.db"), "utf8")).toBe("restored");
        expect(readFileSync(file("dbackup.db.before-restore"), "utf8")).toBe("live");
        expect(readFileSync(file("dbackup.db.before-restore-wal"), "utf8")).toBe("wal of live");
        // No log of the old database may stay beside the restored one, SQLite would play it into it.
        expect(existsSync(file("dbackup.db-wal"))).toBe(false);
        expect(existsSync(file("restore-pending.db"))).toBe(false);
    });

    it("replaces the database a restore before this one left aside", () => {
        writeFileSync(file("dbackup.db"), "live");
        writeFileSync(file("dbackup.db.before-restore"), "older");
        writeFileSync(file("dbackup.db.before-restore-wal"), "wal of older");
        writeFileSync(file("restore-pending.db"), "restored");

        run();

        expect(readFileSync(file("dbackup.db.before-restore"), "utf8")).toBe("live");
        expect(existsSync(file("dbackup.db.before-restore-wal"))).toBe(false);
    });

    it("does nothing without a waiting restore", () => {
        writeFileSync(file("dbackup.db"), "live");

        expect(run()).toBe("");
        expect(readdirSync(dir)).toEqual(["dbackup.db"]);
    });

    it("finds the database of pnpm dev beside schema.prisma, from a relative DATABASE_URL", () => {
        mkdirSync(file("prisma"));
        writeFileSync(file("prisma/dev.db"), "live");
        writeFileSync(file("prisma/restore-pending.db"), "restored");

        run("file:./dev.db");

        expect(readFileSync(file("prisma/dev.db"), "utf8")).toBe("restored");
    });
});
