/**
 * The folder a restore writes into, from the path of one of its writes and the part of that path
 * below the folder, `UploadOptions.restoreRelativePath`. Both come from `safeRemoteJoin`, so the
 * path ends in that part, also once a tenant view put its own folder in front of it. The adapter
 * keeps the write inside this folder, not only inside its connection.
 *
 * @returns The folder as the adapter addresses it, empty for the root of the connection
 * @throws Error for a part that climbs or is absolute, or a path that does not end in it, since the folder is then unknown
 */
export function restoreFolderOf(remotePath: string, relativePath: string): string {
    const full = remotePath.replace(/\\/g, "/");
    const below = relativePath.replace(/\\/g, "/");
    if (below === "" || below.startsWith("/") || below.split("/").some((part) => part === "..")) {
        throw new Error(`Refusing to restore to ${remotePath}: the path below the folder of the restore is no plain path`);
    }
    if (full === below) return "";
    if (full.endsWith(`/${below}`)) return full.slice(0, full.length - below.length - 1);
    throw new Error(`Refusing to restore to ${remotePath}: it does not lie in the folder of the restore`);
}
