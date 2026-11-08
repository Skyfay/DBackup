/**
 * The folders of the lab on this machine, below the storageRoot of the config. Kept apart from
 * the seed, which loads Prisma, so the commands that only start or clean the lab never open a
 * database.
 */

import path from "path";
import type { LabConfig } from "./config";

/** The folder of this machine SQL Server writes its .bak files to when the databases run here. */
export function localMssqlBackupDir(config: LabConfig): string {
    return path.join(config.storageRoot, "lab", "mssql");
}

/** The folder of the Local destination of a workspace. */
export function localBackupDir(config: LabConfig, workspace: string): string {
    return workspace === "main" ? path.join(config.storageRoot, "main") : path.join(config.storageRoot, "workspaces", workspace);
}
