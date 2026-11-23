import type { AuthContext } from "@/lib/auth/access-control";
import { isConfigBackupFile } from "@/services/storage/config-backup-access";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { BulkFailure } from "@/lib/core/bulk";
import { backupPathProblem } from "@/lib/tenant/storage-view";

/**
 * The guard of every route that hands out, opens or restores a file of a destination by its path.
 * A configuration backup is a copy of the whole DBackup database with `ENCRYPTION_KEY` and
 * `BETTER_AUTH_SECRET`, so like the database download under Settings it is only for a platform
 * admin signed in with a session, never for an API key, and never served through a link without
 * a session. The configuration restore reads it through its own routes, see `config-restore-guard.ts`.
 */

/** What a member of a tenant reads when a file is a configuration backup. */
export const CONFIG_BACKUP_ADMIN_ONLY = "This is a configuration backup, a copy of the whole DBackup database with its keys. Only a platform admin signed in to DBackup opens it.";

/** What a link to a configuration backup answers, whoever asks for it. */
export const CONFIG_BACKUP_NO_LINK = "A configuration backup is never handed out through a link. A platform admin downloads it on the Backups page.";

/** Whether a caller opens configuration backups: a platform admin with a session. */
export function readsConfigBackups(ctx: Pick<AuthContext, "isPlatformAdmin" | "authMethod">): boolean {
    return ctx.isPlatformAdmin && ctx.authMethod === "session";
}

const refused = (message: string) => Response.json({ success: false, error: message, message }, { status: 403 });

type FileCaller = Pick<AuthContext, "isPlatformAdmin" | "authMethod" | "tenantId">;

/** Why the caller may not open the file, a configuration backup for someone who is no platform admin with a session, else null. */
export async function configBackupFileRefusal(ctx: FileCaller, storageId: string, file: string): Promise<string | null> {
    if (readsConfigBackups(ctx)) return null;
    return (await isConfigBackupFile(storageId, file, ctx.tenantId)) ? CONFIG_BACKUP_ADMIN_ONLY : null;
}

/**
 * 400 when a path a caller names for a backup could reach past the folder of the destination, see
 * `assertBackupPath`, else null. The guards below ask it first, so no route that opens a file by its
 * path passes one on, also when it forgot to check it.
 */
export function backupPathRefusal(file: unknown): Response | null {
    const problem = backupPathProblem(file);
    return problem ? Response.json({ success: false, error: problem, message: problem }, { status: 400 }) : null;
}

/**
 * 400 for a path that leaves the destination, see `backupPathRefusal`, 403 when the file is a
 * configuration backup and the caller is no platform admin with a session, else null.
 */
export async function configBackupRefusal(ctx: FileCaller, storageId: string, file: string): Promise<Response | null> {
    const badPath = backupPathRefusal(file);
    if (badPath) return badPath;
    const message = await configBackupFileRefusal(ctx, storageId, file);
    return message ? refused(message) : null;
}

/** The paths of a selection split into those the caller may act on and one refusal per configuration backup. */
export interface ConfigBackupSelection {
    allowed: string[];
    refused: BulkFailure[];
}

/** How many files are looked at side by side, each reads its sidecar from the destination. */
const SELECTION_CONCURRENCY = 8;

/**
 * Splits a selection of files of a destination for a bulk delete or lock: a path that leaves the
 * destination is refused on its own row for everyone before any sidecar is read, see
 * `backupPathProblem`, a configuration backup for someone who is no platform admin with a
 * session, and the rest goes on.
 */
export async function configBackupSelection(ctx: FileCaller, storageId: string, paths: readonly string[]): Promise<ConfigBackupSelection> {
    const selection: ConfigBackupSelection = { allowed: [], refused: [] };
    const inside: string[] = [];
    for (const file of paths) {
        const problem = backupPathProblem(file);
        if (problem) selection.refused.push({ id: file, error: problem });
        else inside.push(file);
    }
    if (readsConfigBackups(ctx)) return { allowed: inside, refused: selection.refused };
    const refusals = await mapWithConcurrency(inside, SELECTION_CONCURRENCY, (file) => configBackupFileRefusal(ctx, storageId, file));
    inside.forEach((file, index) => {
        const message = refusals[index];
        if (message) selection.refused.push({ id: file, error: message });
        else selection.allowed.push(file);
    });
    return selection;
}

/** 400 for a path that leaves the destination, 403 when the file is a configuration backup, for a link that is fetched without a session. */
export async function configBackupLinkRefusal(storageId: string, file: string, tenantId: string): Promise<Response | null> {
    const badPath = backupPathRefusal(file);
    if (badPath) return badPath;
    return (await isConfigBackupFile(storageId, file, tenantId)) ? refused(CONFIG_BACKUP_NO_LINK) : null;
}
