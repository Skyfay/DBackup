import { registry } from "@/lib/core/registry";
import type { DirectoryBrowseEntry, StorageAdapter } from "@/lib/core/interfaces";
import { applyStoredSecrets, overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { locationBrowseOf } from "@/lib/adapters/location-browse";
import { ValidationError } from "@/lib/logging/errors";

/** A server that has not answered by then will not, and the dialog should say so rather than spin. */
const BROWSE_TIMEOUT_MS = 15_000;

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
 */
export async function browseLocation(input: BrowseLocationInput): Promise<DirectoryBrowseEntry[]> {
    const browse = locationBrowseOf(input.adapterId);
    const adapter = registry.get(input.adapterId) as StorageAdapter | undefined;
    if (!browse || !adapter?.browseDirectories) {
        throw new ValidationError("This connection cannot browse its folders.", { field: "adapterId" });
    }

    const submitted = input.storedConfigId
        ? await applyStoredSecrets(input.adapterId, input.storedConfigId, { ...input.config })
        : { ...input.config };
    const config = await overlayCredentialsOnConfig(input.adapterId, submitted, input.primaryCredentialId ?? null, null);

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
