import path from "path";
import { stripLeadingSlashes } from "@/lib/paths";

/**
 * The path of a listed file relative to the folder a storage is set to, without a leading "/".
 *
 * The folder is compared as `path.posix.join` writes the paths of a listing, so `/backups//shop/`
 * or `./backups` strips like `/backups/shop`, and only as a whole folder. Compared as typed, such a
 * prefix stayed in front of every path, so a shared destination listed the folder of its customers
 * under another first folder, where its view no longer finds it. A path outside the folder comes
 * back as it is.
 */
export function relativeToPrefix(fullPath: string, prefix: string): string {
    const file = fullPath.replace(/\\/g, "/");
    const base = prefix ? path.posix.normalize(prefix.replace(/\\/g, "/")) : "";
    const root = base === "." || base === "./" ? "" : base;
    let relative = file;
    if (root) {
        const folder = root.endsWith("/") ? root : `${root}/`;
        if (file === root) relative = "";
        else if (file.startsWith(folder)) relative = file.slice(folder.length);
    }
    return stripLeadingSlashes(relative);
}
