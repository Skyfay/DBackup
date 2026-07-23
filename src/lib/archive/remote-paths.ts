import path from "path";

/**
 * Builds the remote path a restored file is written to, refusing anything that escapes
 * the chosen target directory.
 *
 * The relative path comes out of the archive index, which is attacker-controlled in the
 * threat model that matters: on an unencrypted backup the `.index` sidecar sits next to
 * the archive and can be edited by anyone with write access to the destination, and the
 * paths inside it originally came from a source server. A `../` segment would otherwise
 * let a restore write anywhere the destination credentials reach - a job's own backup
 * folder, another job's, or an SFTP account's `.ssh/authorized_keys`.
 *
 * The local extraction path has had this guard from the start (`safeJoin` in extract.ts);
 * this is the same rule for destinations addressed by POSIX-style remote paths.
 */
export function safeRemoteJoin(basePath: string, relativePath: string): string {
    const base = basePath.replace(/\\/g, "/").replace(/\/+$/, "");
    const relative = relativePath.replace(/\\/g, "/");

    if (relative.startsWith("/")) {
        throw new Error(`Refusing to restore an absolute path: ${relativePath}`);
    }

    // Only the relative part is normalised, against a sentinel root: at a real root
    // `path.posix.normalize` silently collapses a leading "/.." to "/", which would hide
    // exactly the escape being looked for. The sentinel gives the ".." something to
    // consume, so an escape stays visible. The target itself is then appended verbatim,
    // preserving whether it was absolute.
    const SENTINEL = "/__target__";
    const probe = path.posix.normalize(`${SENTINEL}/${relative}`);

    if (probe !== SENTINEL && !probe.startsWith(`${SENTINEL}/`)) {
        throw new Error(`Refusing to restore outside the target directory: ${relativePath}`);
    }

    const safeRelative = probe.slice(SENTINEL.length + 1);
    return base === "" ? safeRelative : `${base}/${safeRelative}`;
}
