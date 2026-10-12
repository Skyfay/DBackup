/**
 * The environment of the app in this checkout: `.env` and the dev database it points at. The
 * commands that open the database call `loadAppEnv` before they import anything of the app, since
 * Prisma and the encryption read `DATABASE_URL` and `ENCRYPTION_KEY` when their modules load.
 */

import { existsSync } from "fs";
import path from "path";
import { REPO_ROOT } from "./config";

export function loadAppEnv(): void {
    // The app logs every record it creates. Here only problems are worth a line, LAB_LOG_LEVEL shows more.
    process.env.LOG_LEVEL = process.env.LAB_LOG_LEVEL ?? "warn";
    const envFile = path.join(REPO_ROOT, ".env");
    if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/** The SQLite file of DATABASE_URL, relative paths being relative to the Prisma schema. */
export function devDatabaseFile(): string {
    const url = process.env.DATABASE_URL ?? "file:./dev.db";
    const file = url.replace(/^file:/, "").split("?")[0];
    return path.isAbsolute(file) ? file : path.join(REPO_ROOT, "prisma", file);
}
