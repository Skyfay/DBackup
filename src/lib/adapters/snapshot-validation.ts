import { registry } from "@/lib/core/registry";
import { overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { ValidationError } from "@/lib/logging/errors";
import { STORAGE_ROLES, type StorageRole } from "@/lib/core/storage-roles";
import type { StorageAdapter } from "@/lib/core/interfaces";

/**
 * Refuses to store a snapshot-enabled config the server cannot actually deliver on.
 *
 * The form gates its toggle on the same probe, but the gate has to exist here too: a
 * direct API call would otherwise create a job that believes it takes snapshot-consistent
 * backups and silently does not. Since a run is set to fail outright when snapshots turn
 * out to be unavailable, letting one be configured against a server that never supported
 * them would only produce failures later.
 *
 * Snapshots are a directory-source concern - a point-in-time copy of the place backups are
 * written to has no purpose - so enabling it on a destination is rejected outright rather
 * than probed.
 */
export async function validateSnapshotConfig(
    adapterId: string,
    config: Record<string, unknown>,
    storageRole: StorageRole,
    primaryCredentialId: string | null,
    sshCredentialId: string | null
): Promise<void> {
    if (config?.useVss !== true) return;

    if (storageRole !== STORAGE_ROLES.SOURCE) {
        throw new ValidationError("Shadow copies can only be enabled on a directory source, not on a backup destination.");
    }

    const adapter = registry.get(adapterId) as StorageAdapter | undefined;
    if (!adapter?.supportsSnapshot) {
        throw new ValidationError(`Adapter '${adapterId}' does not support shadow copies.`);
    }

    const merged = await overlayCredentialsOnConfig(adapterId, { ...config }, primaryCredentialId, sshCredentialId);
    const result = await adapter.supportsSnapshot(merged, "");
    if (!result.supported) {
        throw new ValidationError(`Shadow copies are not available on this server: ${result.message}`);
    }
}
