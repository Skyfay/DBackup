import type { AuthContext } from "@/lib/auth/access-control";
import { isConfigBackupFile } from "@/services/storage/config-backup-access";

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

/** 403 when the file is a configuration backup and the caller is no platform admin with a session, else null. */
export async function configBackupRefusal(ctx: FileCaller, storageId: string, file: string): Promise<Response | null> {
    const message = await configBackupFileRefusal(ctx, storageId, file);
    return message ? refused(message) : null;
}

/** 403 when the file is a configuration backup, for a link that is fetched without a session. */
export async function configBackupLinkRefusal(storageId: string, file: string, tenantId: string): Promise<Response | null> {
    return (await isConfigBackupFile(storageId, file, tenantId)) ? refused(CONFIG_BACKUP_NO_LINK) : null;
}
