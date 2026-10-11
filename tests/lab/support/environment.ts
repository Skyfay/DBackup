/**
 * Where the lab tests keep their own database and under which workspace name they write to the
 * storage servers, so a run never touches the dev database or the backups of a workspace.
 * Read by vitest.lab.config.ts and the global setup alike, so it holds no state of its own.
 */

import { createHash } from "crypto";
import os from "os";
import path from "path";
import { currentWorkspace, folderName } from "../../../lab/src/workspace";

/** The workspace the tests write their backups under, one per checkout. */
export const TEST_WORKSPACE = folderName(`test-${currentWorkspace()}`);

export const TEST_DATABASE = path.join(os.tmpdir(), "dbackup-lab-tests", TEST_WORKSPACE, "dbackup.db");

/** A key derived from the workspace, since every process of a run has to arrive at the same one. */
const testKey = (purpose: string) => createHash("sha256").update(`dbackup-lab-tests ${TEST_WORKSPACE} ${purpose}`).digest("hex");

/** What the app reads from the environment when its modules load. */
export function testEnvironment(): Record<string, string> {
    return {
        DATABASE_URL: `file:${TEST_DATABASE}`,
        ENCRYPTION_KEY: testKey("encryption"),
        BETTER_AUTH_SECRET: testKey("auth"),
        BETTER_AUTH_URL: "http://localhost:3000",
        // The app logs every step of a run. Here only problems are worth a line, LAB_LOG_LEVEL shows more.
        LOG_LEVEL: process.env.LAB_LOG_LEVEL ?? "warn",
    };
}
