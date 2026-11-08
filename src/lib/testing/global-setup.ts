import { execFileSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import path from "path";

/**
 * The database and the key the unit tests run with, the same on every machine. Code under test
 * that reads the database without a mock, like the guard of DBackup's own data, reads this empty
 * one, never the dev.db of the checkout, so a test no longer passes or fails by what a developer
 * has in it, and passes in CI, where no .env exists. Prisma leaves variables that are set alone
 * when it loads .env, so these win over it.
 */
export const UNIT_TEST_DB = path.join(process.cwd(), "node_modules", ".cache", "dbackup-unit-tests", "unit.db");
export const UNIT_TEST_ENV = {
    DATABASE_URL: `file:${UNIT_TEST_DB}`,
    // 64 hex characters like a real key, a test value used nowhere else.
    ENCRYPTION_KEY: "7e57000000000000000000000000000000000000000000000000000000007e57",
};

/** Builds the empty database of the unit tests from the migrations, once per run. */
export default function setup(): void {
    rmSync(path.dirname(UNIT_TEST_DB), { recursive: true, force: true });
    mkdirSync(path.dirname(UNIT_TEST_DB), { recursive: true });
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, ...UNIT_TEST_ENV },
        stdio: "pipe",
    });
}
