import { openStorage } from "./storage-lookup";

/** Whether a directory restore would write into a folder that holds files already. */
export type RestorePathCheck =
    | { status: "occupied" | "empty"; itemCount: number }
    | { status: "unverified" };

/**
 * Checks whether a directory restore target already has content, for the Overwrite/Empty badge in
 * the restore UI. `list()` cannot distinguish "path does not exist yet" from "path exists but is
 * empty" (both return []), so the only signal available without a new adapter interface member
 * is: any files found -> "occupied", none found -> "empty". A storage that cannot list the path
 * leaves it "unverified".
 *
 * Throws `NotFoundError` when no storage has this id.
 */
export async function checkRestorePath(storageId: string, targetPath: string): Promise<RestorePathCheck> {
    const { adapter, config } = await openStorage(storageId);
    try {
        const entries = await adapter.list(config, targetPath);
        return { status: entries.length > 0 ? "occupied" : "empty", itemCount: entries.length };
    } catch {
        return { status: "unverified" };
    }
}
