import type { AdapterConfig } from "@prisma/client";
import { registry } from "@/lib/core/registry";
import type { DirectoryBrowseEntry, StorageAdapter } from "@/lib/core/interfaces";
import { applyStoredSecrets, layLoginsOver, overlayCredentialsOnConfig, resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { hostLocalReason } from "@/lib/adapters/host-local";
import { decryptConfig } from "@/lib/crypto";
import prisma from "@/lib/prisma";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { locationBrowseOf } from "@/lib/adapters/location-browse";
import { answerOf } from "@/lib/adapters/adapter-answer";
import { ValidationError } from "@/lib/logging/errors";
import { assertSourceFolder } from "@/lib/archive/remote-paths";
import { storageView } from "@/lib/tenant/storage-view";
import { isShared, viewerOf, viewModeOf } from "@/services/sharing/destination-access";
import { assertMayReachHost } from "./adapter-create";

/** A server that has not answered by then will not, and the dialog should say so rather than spin. */
const BROWSE_TIMEOUT_MS = 15_000;

/** Why the folder of a destination shared with other tenants is not picked again, see `updateAdapter`. */
const SHARED_FOLDER_STAYS = "It is shared with other tenants, so its folder stays as it is and is not picked again. Stop sharing it first.";

export interface BrowseLocationInput {
    adapterId: string;
    /** The config as the form holds it, not saved yet. */
    config: Record<string, unknown>;
    /** The saved connection being edited, whose secrets the form never gets back. */
    storedConfigId?: string;
    primaryCredentialId?: string | null;
    /** The folder to list, relative to where the adapter starts browsing, "" for its top. */
    path: string;
}

/**
 * The folders one level below `path` of a storage connection that is being added or changed, for
 * picking its folder. The form's config is merged with its login like a connection test, and the
 * adapter lists from the top of its storage instead of from the folder the form holds.
 *
 * @throws ValidationError for an adapter that cannot browse, a saved destination shared with other
 *   tenants, whose top holds the folders of its customers, a config that reaches the server
 *   DBackup runs on for anyone but a platform admin, or a path that leaves the top by a `..`.
 */
export async function browseLocation(input: BrowseLocationInput): Promise<DirectoryBrowseEntry[]> {
    // The adapter joins the path onto its top, so a `..` would list the folders above it.
    assertSourceFolder(input.path);
    const browse = locationBrowseOf(input.adapterId);
    const adapter = registry.get(input.adapterId) as StorageAdapter | undefined;
    if (!browse || !adapter?.browseDirectories) {
        throw new ValidationError("This connection cannot browse its folders.", { field: "adapterId" });
    }
    // Its folder cannot change while it is shared, and the browse would list the folder of the
    // customers with the saved login, which the view of its tenant hides.
    if (input.storedConfigId && (await isShared(input.storedConfigId))) {
        throw new ValidationError(SHARED_FOLDER_STAYS, { field: "configId" });
    }

    const submitted = input.storedConfigId
        ? await applyStoredSecrets(input.adapterId, input.storedConfigId, { ...input.config }, { primaryCredentialId: input.primaryCredentialId })
        : { ...input.config };
    const config = await overlayCredentialsOnConfig(input.adapterId, submitted, input.primaryCredentialId ?? null, null);
    // A browse runs the connection like a save would store it, rsync with its options among others.
    await assertMayReachHost(input.adapterId, config);

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`The storage did not answer within ${BROWSE_TIMEOUT_MS / 1000} seconds.`)), BROWSE_TIMEOUT_MS);
    });
    try {
        return await Promise.race([adapter.browseDirectories({ ...config, pathPrefix: browse.root }, input.path), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The folders one level below `path` of a saved storage connection, within its own folder, for
 * the folder tree of a directory source. Null when the adapter cannot browse, and for a destination
 * shared with other tenants, whose folders hold those of its customers: the view of its tenant
 * leaves the browse out, see `storageView`.
 *
 * @throws ValidationError for a path that leaves the folder of the connection by a `..`, which
 *   SFTP, FTP and SMB would join onto the folder they are set to, like the folder of a source.
 */
export async function browseSavedFolders(source: AdapterConfig, path: string): Promise<DirectoryBrowseEntry[] | null> {
    assertSourceFolder(path);
    const adapter = registry.get(source.adapterId) as StorageAdapter | undefined;
    if (!adapter?.browseDirectories) return null;

    const mode = await viewModeOf(source, await viewerOf(source));
    const view = mode ? storageView(adapter, mode) : null;
    if (!view?.browseDirectories) return null;

    const config = await resolveAdapterConfig(source);
    const browse = view.browseDirectories;
    // What the server says goes back to the picker, a failure of DBackup itself does not.
    return answerOf(source.adapterId, "browse", () => browse(config, path));
}

/**
 * Who may look into a saved connection that reaches the server DBackup runs on, see `hostLocalReason`:
 * whoever picks its folders or volumes, in a job or as the target of a restore. Its folders and the
 * volumes of the Docker of that server are the server's own, so a member who may only see the
 * connections does not list them. A platform admin holds both.
 */
export const HOST_FOLDER_PICKERS: readonly Permission[] = [PERMISSIONS.JOBS.WRITE, PERMISSIONS.STORAGE.RESTORE];

/**
 * Whether a saved connection of the tenant that runs now reaches the server DBackup runs on, with
 * its saved logins laid over its config, see `hostLocalReason`. False for a connection the tenant
 * does not see, whose browse fails on its own, and a config that cannot be read counts as one that
 * reaches it, the stricter way.
 */
export async function savedConnectionReachesHost(id: string): Promise<boolean> {
    const row = await prisma.adapterConfig.findUnique({
        where: { id },
        select: { adapterId: true, config: true, primaryCredentialId: true, sshCredentialId: true },
    });
    if (!row) return false;
    let config: Record<string, unknown>;
    try {
        config = decryptConfig(JSON.parse(row.config)) as Record<string, unknown>;
    } catch {
        return true;
    }
    try {
        config = await layLoginsOver(row.adapterId, { ...config }, row.primaryCredentialId, row.sshCredentialId);
    } catch {
        // A login that cannot be read fails the browse anyway, the config alone speaks for it then.
    }
    return hostLocalReason(row.adapterId, config) !== null;
}
