import type { Client } from "basic-ftp";
import path from "path";

/**
 * How a write of a restore over FTP stays inside the folder of the restore.
 *
 * FTP takes a path as text, and a server follows a symbolic link when it enters a folder or stores
 * a file. A restore writes into folders that other users and programs write to as well, so a link
 * planted at a folder below the folder of the restore would carry the restored file out of it, and
 * a link at the name of the file would carry its bytes to wherever it points. FTP has no way to ask
 * where a link leads, so unlike `sftp.ts` no link is followed at all: every folder below the folder
 * of the restore is looked up in the listing of the folder above it and refused when the server
 * lists it as a link or as anything but a folder, and a link at the name of the file is deleted
 * before the upload, which removes the link and never what it points at. Folders above the folder
 * of the restore are the setup of the server and are entered as before.
 *
 * This rests on the listing of the server. One that lists a link to a folder as a plain folder
 * hides it from this check.
 */

type Kind = "d" | "l" | "o";

const listedKey = (dir: string) => `restore-listed:${dir}`;
const kindKey = (kind: Kind, entry: string) => `restore-kind:${kind}:${entry}`;

/** Reads the listing of a folder once per session and keeps what kind each of its entries is. */
async function rememberListing(client: Client, dir: string, cache: Set<string>): Promise<void> {
    if (cache.has(listedKey(dir))) return;
    for (const entry of await client.list(dir)) {
        const kind: Kind = entry.isSymbolicLink ? "l" : entry.isDirectory ? "d" : "o";
        cache.add(kindKey(kind, path.posix.join(dir, entry.name)));
    }
    cache.add(listedKey(dir));
}

function kindOf(entry: string, cache: Set<string>): Kind | undefined {
    return (["l", "d", "o"] as const).find((kind) => cache.has(kindKey(kind, entry)));
}

/**
 * Creates the folders of one write of a restore and refuses a link or a file on the way, then
 * removes a link at the name of the file, see the top of this file.
 *
 * @param folder - The folder of the restore as the server addresses it, with the folder setting, empty for the folder of the login
 * @param relativePath - The path of the file below that folder, `UploadOptions.restoreRelativePath`
 * @param cache - What this session knows about the folders, shared by its connections
 * @throws Error for a folder below the folder of the restore that is a link or no folder
 */
export async function ensureFtpRestoreDir(client: Client, folder: string, relativePath: string, cache: Set<string>): Promise<void> {
    const below = relativePath.replace(/\\/g, "/");
    const root = folder === "" ? "." : folder;
    if (root !== "." && root !== "/" && !cache.has(`restore-root:${root}`)) {
        await client.ensureDir(root);
        await client.cd("/");
        cache.add(`restore-root:${root}`);
    }

    let current = root;
    for (const part of path.posix.dirname(below).split("/")) {
        if (part === "" || part === ".") continue;
        const parent = current;
        current = path.posix.join(parent, part);
        await rememberListing(client, parent, cache);
        const kind = kindOf(current, cache);
        if (kind === undefined) {
            await client.ensureDir(current);
            await client.cd("/");
            // New and empty, so nothing in it is a link.
            cache.add(kindKey("d", current));
            cache.add(listedKey(current));
        } else if (kind !== "d") {
            throw new Error(`Refusing to restore below ${current}: it is ${kind === "l" ? "a symbolic link" : "no folder"}, which could lead the write out of the folder of the restore.`);
        }
    }

    await rememberListing(client, current, cache);
    const destination = path.posix.join(current, path.posix.basename(below));
    if (kindOf(destination, cache) === "l") {
        // DELE removes the link itself, never what it points at.
        await client.remove(destination);
        cache.delete(kindKey("l", destination));
    }
}
