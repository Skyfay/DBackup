import { openRow } from "@/services/sharing/destination-access";
import { findRestoreTarget } from "@/services/restore/restore-target";
import { assertRestoreFolder } from "@/lib/archive/remote-paths";

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
 * The target of a restore of files may be a directory source as well as a destination, and is found
 * the way a restore finds it, see `findRestoreTarget`, so a shared destination that takes only
 * encrypted backups is not offered. Throws `NotFoundError` when no storage the tenant may restore
 * into has this id, and `ValidationError` for a folder that leaves the connection, see
 * `assertRestoreFolder`.
 */
export async function checkRestorePath(storageId: string, targetPath: string): Promise<RestorePathCheck> {
    assertRestoreFolder(targetPath);
    const { row, mode } = await findRestoreTarget(storageId);
    const { adapter, config } = await openRow(row, mode);
    try {
        const entries = await adapter.list(config, targetPath);
        return { status: entries.length > 0 ? "occupied" : "empty", itemCount: entries.length };
    } catch {
        return { status: "unverified" };
    }
}
