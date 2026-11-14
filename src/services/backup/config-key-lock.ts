/**
 * Keeps the key of the configuration backup to its one use outside a platform admin's hands.
 *
 * The configuration backup is one AES-256-GCM stream directly under the master key of the profile
 * `config.backup.profileId` names, the same format older database backups have. Whether a file is a
 * configuration backup is read from its path and its sidecar, which whoever stores a copy of it
 * chooses, so a copy under the name of a job would open with that key for anyone who may download
 * or restore a backup. A decryption of a whole file therefore never uses that profile unless a
 * platform admin with a session asks, whatever the file is called and wherever the profile id comes
 * from: the sidecar, the request or Smart Recovery.
 *
 * A seekable archive is not affected. Its entries are encrypted with keys derived from the profile
 * key and a salt (`deriveArchiveKeys`), so nothing in that format opens a stream encrypted with the
 * profile key itself, and a job may keep using the same profile.
 */

import type { AuthContext } from "@/lib/auth/access-control";
import { getConfigBackupKeyId } from "@/services/config/config-backup-targets";
import type { KeyRefusal } from "./key-resolution";

/** Who asks for a decryption, as far as the key it may use depends on it. */
export type KeyCaller = Pick<AuthContext, "isPlatformAdmin" | "authMethod">;

/**
 * The profiles a decryption of a whole file may not use for this caller: the key of the
 * configuration backup, for anyone but a platform admin with a session, like `readsConfigBackups`.
 * A caller nobody names, like a link without a session, counts as no platform admin.
 */
export function wholeFileKeyRefusal(caller: KeyCaller | undefined): KeyRefusal {
    let configKey: Promise<string | null> | undefined;
    return async (profileId: string) => {
        if (caller?.isPlatformAdmin && caller.authMethod === "session") return false;
        configKey ??= getConfigBackupKeyId();
        return profileId === (await configKey);
    };
}
