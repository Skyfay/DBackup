/**
 * Loads the dataset of lab/datasets into each database container once, through the client inside
 * the container and its standard input. Nothing is mounted, so it works on a remote host too. The
 * file and the commands of each engine are in its engine file.
 */

import { readFileSync } from "fs";
import path from "path";
import { REPO_ROOT, type LabConfig } from "./config";
import type { DatabaseService } from "./catalog";
import { execIn } from "./docker";
import { engineOf } from "./engines";

/** Whether a database service holds the dataset, from what the dataset makes last. */
export async function hasDataset(config: LabConfig, database: DatabaseService): Promise<boolean> {
    const check = await execIn(config, database.service, engineOf(database.engine).dataset.check, undefined, 60_000);
    return check.code === 0 && check.stdout.trim() !== "";
}

/** Loads the dataset into one database service, unless it holds it already. Returns whether it loaded. */
export async function loadDataset(config: LabConfig, database: DatabaseService): Promise<boolean> {
    if (await hasDataset(config, database)) return false;
    const dataset = engineOf(database.engine).dataset;
    const content = readFileSync(path.join(REPO_ROOT, "lab", "datasets", dataset.file), "utf8");
    const result = await execIn(config, database.service, dataset.load, content);
    if (result.code !== 0) throw new Error(`Loading the dataset into ${database.service} failed:\n${result.stderr || result.stdout}`);
    return true;
}
