/**
 * A copy of the database replaces the live one while DBackup is down: the copy is made ready and
 * laid beside the live database as `restore-pending.db`, DBackup ends, and on its next start
 * `scripts/apply-pending-restore.js` swaps the files before `prisma migrate deploy` brings an
 * older copy up to date. The database of now stays as `dbackup.db.before-restore`.
 */

import { promises as fs } from "fs";
import path from "path";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { restartSoon } from "@/lib/server/restart";
import { getDatabaseFilePath } from "@/services/system/database-service";
import { COPY_KEYS_SETTING, DROPPED_TABLES, openCopy, type CopyKeys } from "./database-copy";
import { rekeyCopy } from "./copy-rekey";

/** The name the swap script looks for beside the live database. */
export const PENDING_RESTORE_FILE = "restore-pending.db";

/** Who restored which file, written into the audit log of the copy, which is the one that stays. */
export interface RestoreRecord {
    actorName: string | null;
    fileName: string;
}

/** Makes a copy ready to be the database here: encrypted for this DBackup, without sign-ins and without anything that runs by itself. */
async function prepareCopy(file: string, keys: CopyKeys | null, record: RestoreRecord): Promise<void> {
    const copy = openCopy(file);
    try {
        // The schema of DBackup has no trigger or view. One in a copy would run in the database here.
        const extras = await copy.$queryRawUnsafe<{ type: string; name: string }[]>(`SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'view')`);
        for (const { type, name } of extras) await copy.$executeRawUnsafe(`DROP ${type === "view" ? "VIEW" : "TRIGGER"} IF EXISTS "${name.replace(/"/g, '""')}"`);

        if (keys) await rekeyCopy(copy, keys);
        await copy.$executeRawUnsafe(`DELETE FROM "SystemSetting" WHERE "key" = ?`, COPY_KEYS_SETTING);
        for (const table of DROPPED_TABLES) await copy.$executeRawUnsafe(`DELETE FROM "${table}"`);
        await copy.auditLog.create({
            data: {
                action: AUDIT_ACTIONS.RESTORE,
                resource: AUDIT_RESOURCES.SYSTEM,
                actorName: record.actorName,
                details: JSON.stringify({ action: "config_restore", file: record.fileName, kind: "database" }),
            },
        });
    } finally {
        await copy.$disconnect();
    }
}

/**
 * Lays a checked copy beside the live database and restarts DBackup, which takes it on its next
 * start. Everyone signs in again afterwards, with an account of the backup.
 */
export async function stageDatabaseRestore(file: string, keys: CopyKeys | null, record: RestoreRecord): Promise<void> {
    await prepareCopy(file, keys, record);
    const target = path.join(path.dirname(await getDatabaseFilePath()), PENDING_RESTORE_FILE);
    // The temp folder may lie on another disk than the database, so it is copied, then renamed.
    await fs.copyFile(file, `${target}.part`);
    await fs.rename(`${target}.part`, target);
    await fs.unlink(file).catch(() => undefined);
    restartSoon("A configuration restore waits for the restart");
}
