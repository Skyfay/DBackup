import { toast } from "sonner";
import { CONFIG_BACKUP_KEY_LOCKED, CONFIG_BACKUP_LOGIN_LOCKED } from "@/lib/core/config-backup-locks";
import type { VaultCredential, VaultKey } from "@/services/vault/vault-types";

/**
 * The key and the logins the configuration backup goes through are revealed, exported and changed
 * by a platform admin alone, and the server refuses everyone else. These say why a button of the
 * Vault stays shut for the viewer, null when it opens.
 */

export function keyLock(key: Pick<VaultKey, "configBackup">, isPlatformAdmin: boolean): string | null {
    return key.configBackup && !isPlatformAdmin ? CONFIG_BACKUP_KEY_LOCKED : null;
}

export function loginLock(profile: Pick<VaultCredential, "configBackup">, isPlatformAdmin: boolean): string | null {
    return profile.configBackup && !isPlatformAdmin ? CONFIG_BACKUP_LOGIN_LOCKED : null;
}

/** The action of a row, which says why instead when the row is locked. Undefined stays undefined. */
export function unlessLocked<T>(lock: (row: T) => string | null, action: ((row: T) => void) | undefined): ((row: T) => void) | undefined {
    if (!action) return undefined;
    return (row) => {
        const reason = lock(row);
        if (reason) toast.error(reason);
        else action(row);
    };
}
