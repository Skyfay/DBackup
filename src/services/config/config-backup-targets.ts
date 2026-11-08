/**
 * What the configuration backup goes through: the destination it writes to, the saved logins that
 * destination signs in with and the key it is encrypted with. The file holds every secret of the
 * instance, so only a platform admin changes, reveals or deletes these, see
 * `src/lib/server/config-backup-target-guard.ts`.
 */

import prisma from "@/lib/prisma";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/** The settings that name the destination and the key, the same as `config-backup-settings.ts`. */
const STORAGE_SETTING = "config.backup.storageId";
const PROFILE_SETTING = "config.backup.profileId";

export interface ConfigBackupTargets {
    /** The destination, null while none is picked. */
    storageId: string | null;
    /** The key, null while none is picked. */
    profileId: string | null;
    /** The saved logins of the destination, its login and its SSH login. */
    credentialIds: string[];
}

/** What the configuration backup is set to go through now, whether it is switched on or not. */
export async function getConfigBackupTargets(): Promise<ConfigBackupTargets> {
    const rows = await prisma.systemSetting.findMany({
        where: { key: { in: [STORAGE_SETTING, PROFILE_SETTING] } },
        select: { key: true, value: true },
    });
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const storageId = stored.get(STORAGE_SETTING) || null;
    const profileId = stored.get(PROFILE_SETTING) || null;
    if (!storageId) return { storageId, profileId, credentialIds: [] };

    // The destination belongs to the home tenant, whichever tenant the request works in.
    const destination = await runAsTenant(HOME_TENANT_ID, () =>
        prisma.adapterConfig.findUnique({ where: { id: storageId }, select: { primaryCredentialId: true, sshCredentialId: true } })
    );
    const credentialIds = [destination?.primaryCredentialId, destination?.sshCredentialId].filter((id): id is string => !!id);
    return { storageId, profileId, credentialIds };
}

/**
 * The key the configuration backup is encrypted with now, null while none is picked. Only a
 * platform admin picks, reveals or changes it, so a file it opens came from DBackup.
 */
export async function getConfigBackupKeyId(): Promise<string | null> {
    const row = await prisma.systemSetting.findUnique({ where: { key: PROFILE_SETTING }, select: { value: true } });
    return row?.value || null;
}
