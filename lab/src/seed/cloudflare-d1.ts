/**
 * The Cloudflare D1 source of the lab. D1 runs at Cloudflare and nowhere else, so the lab needs a
 * Cloudflare account of its own for tests (`cloudflareD1` in the lab config), and without one it
 * has no D1 source. The seed makes sure the account holds the database `dbackup-lab-shop` with the
 * SQLite dataset of the lab, and adds the source with its token.
 */

import { readFileSync } from "fs";
import os from "os";
import path from "path";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { d1Request, databaseIdOf, findDatabase, query } from "@/lib/adapters/database/cloudflare-d1/api";
import { importDatabase } from "@/lib/adapters/database/cloudflare-d1/jobs";
import { REPO_ROOT, type LabConfig } from "../config";
import { ensureCredential } from "./records";
import type { Note } from "./sources";

/** The database of the lab in the test account. */
export const LAB_D1_DATABASE = "dbackup-lab-shop";

/** The database of the lab, created and filled with the dataset when it is missing or empty. */
async function ensureLabDatabase(connection: { accountId: string; token: string }, log: string[]): Promise<void> {
    let database = await findDatabase(connection, LAB_D1_DATABASE);
    if (!database) {
        const { result } = await d1Request<{ uuid: string }>(connection, "seed", "POST", "/d1/database", { name: LAB_D1_DATABASE });
        database = { uuid: databaseIdOf(result.uuid), name: LAB_D1_DATABASE };
        log.push(`created the D1 database ${LAB_D1_DATABASE}`);
    }
    const uuid = databaseIdOf(database.uuid);
    const [tables] = await query<{ n: number }>(connection, uuid, "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'customers'");
    if (Number(tables?.results?.[0]?.n) > 0) return;

    const folder = await mkdtemp(path.join(os.tmpdir(), "lab-d1-"));
    try {
        const file = path.join(folder, "shop.sql");
        await writeFile(file, readFileSync(path.join(REPO_ROOT, "lab", "datasets", "sqlite.sql"), "utf8"));
        await importDatabase(connection, uuid, file, () => undefined);
        log.push(`filled the D1 database ${LAB_D1_DATABASE} with the dataset of SQLite`);
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}

export async function seedCloudflareD1(config: LabConfig, note: Note, log: string[]): Promise<void> {
    const account = config.cloudflareD1;
    if (!account) {
        log.push("skipped Cloudflare D1, the lab config has no cloudflareD1");
        return;
    }
    try {
        await ensureLabDatabase(account, log);
    } catch (error) {
        log.push(`could not prepare the D1 database ${LAB_D1_DATABASE}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const token = await ensureCredential("Lab Cloudflare D1 token", "TOKEN", { token: account.token });
    await note({
        name: "Lab Cloudflare D1",
        type: "database",
        adapterId: "cloudflare-d1",
        config: { accountId: account.accountId, database: "", checkLargeIntegers: true, newDatabaseLocation: "auto" },
        primaryCredentialId: token,
    }, "cloudflare-d1");
}
