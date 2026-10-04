import fs from "fs/promises";
import path from "path";
import Client from "ssh2-sftp-client";
import { overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { DBackupError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ service: "FilesystemService" });

export interface FilesystemEntry {
    name: string;
    type: "directory" | "file";
    path: string;
    /** Bytes, for files only. */
    size?: number;
    /** When the entry last changed, as an ISO string. */
    modified?: string;
}

export interface DirectoryListing {
    currentPath: string;
    parentPath: string;
    entries: FilesystemEntry[];
}

/**
 * Sensitive OS paths that must never be browsed.
 * Covers Linux, macOS, and Windows system directories.
 */
const BLOCKED_PREFIXES = [
    // Linux virtual/kernel filesystems
    "/proc", "/sys", "/dev",
    // Linux/macOS sensitive config
    "/etc/shadow", "/etc/gshadow", "/etc/sudoers.d",
    // macOS system internals
    "/System", "/Library/Keychains", "/private/var/db",
    // Windows system paths (when running under WSL or mapped drives)
    "/mnt/c/Windows", "/mnt/c/Program Files",
];

/** A path the file browser must not show. The route answers it with 403. */
export class BlockedPathError extends DBackupError {
    constructor(requested: string) {
        super("Access denied", "BLOCKED_PATH", { context: { path: requested } });
    }
}

function isBlocked(candidate: string): boolean {
    return BLOCKED_PREFIXES.some((prefix) => candidate === prefix || candidate.startsWith(prefix + "/"));
}

/**
 * Resolves a user-provided path to an absolute one the browser may list, or throws
 * `BlockedPathError`. The target of a link is checked as well, so a link cannot lead into a
 * blocked area, like `/var/db` into `/private/var/db` on macOS.
 */
export async function resolveBrowsablePath(userPath: string): Promise<string> {
    const resolved = path.resolve(userPath);
    if (isBlocked(resolved)) throw new BlockedPathError(userPath);
    // A path that does not exist has no target yet and fails later as not found.
    const target = await fs.realpath(resolved).catch(() => resolved);
    if (isBlocked(target)) throw new BlockedPathError(userPath);
    return resolved;
}

/** Folders first, then by name. */
function sortEntries(entries: FilesystemEntry[]): FilesystemEntry[] {
    return entries.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === "directory" ? -1 : 1;
    });
}

/**
 * Lists a directory on the machine DBackup runs on, for the file browser of a path field. It
 * returns names, sizes and dates only and never reads a file.
 */
export async function listLocalDirectory(requestedPath: string): Promise<DirectoryListing> {
    const currentPath = await resolveBrowsablePath(requestedPath);

    let stats;
    try {
        // lgtm[js/path-injection] - Authenticated admin file browser with blocklist validation
        stats = await fs.stat(currentPath);
    } catch {
        throw new NotFoundError("Path", currentPath);
    }
    if (!stats.isDirectory()) throw new ValidationError("Not a directory");

    // lgtm[js/path-injection] - Authenticated admin file browser with blocklist validation
    const dirents = await fs.readdir(currentPath, { withFileTypes: true });
    const entries = await Promise.all(
        dirents.map(async (dirent): Promise<FilesystemEntry> => {
            const full = path.join(currentPath, dirent.name);
            // One stat per entry for its size and date. It follows links, so a link to a folder
            // opens like a folder, and a broken link is listed without either.
            const info = await fs.stat(full).catch(() => null);
            const isDirectory = dirent.isDirectory() || (info?.isDirectory() ?? false);
            return {
                name: dirent.name,
                type: isDirectory ? "directory" : "file",
                path: full,
                ...(info && !isDirectory ? { size: info.size } : {}),
                ...(info ? { modified: info.mtime.toISOString() } : {}),
            };
        })
    );

    return { currentPath, parentPath: path.dirname(currentPath), entries: sortEntries(entries) };
}

export interface RemoteListingInput {
    /** The SSH part of the adapter config, with `host` at least. */
    config: Record<string, unknown> | null | undefined;
    path?: string;
    adapterId?: string;
    sshCredentialId?: string | null;
}

/**
 * Lists a directory on a server over SFTP, for a path field whose file lives there, like an
 * SQLite database in SSH mode. The login comes from the SSH credential profile when one is set.
 */
export async function listRemoteDirectory({ config, path: requestedPath = "/", adapterId, sshCredentialId }: RemoteListingInput): Promise<DirectoryListing> {
    if (!config || !config.host) throw new ValidationError("Missing SSH configuration");

    let resolved: Record<string, unknown> = { ...config };
    if (adapterId && sshCredentialId) {
        try {
            resolved = (await overlayCredentialsOnConfig(adapterId, resolved, null, sshCredentialId)) as Record<string, unknown>;
        } catch (error: unknown) {
            log.warn("Failed to overlay SSH credential for file browser", { adapterId, sshCredentialId }, wrapError(error));
            throw new ValidationError("Failed to resolve SSH credential profile");
        }
    }

    const sftp = new Client();
    try {
        await sftp.connect({
            host: resolved.host as string,
            port: (resolved.port as number) || 22,
            username: resolved.username as string,
            password: resolved.password as string | undefined,
            privateKey: resolved.privateKey as string | undefined,
            passphrase: resolved.passphrase as string | undefined,
            readyTimeout: 10000,
        });

        // An empty path lists the home directory of the SSH user.
        const targetPath = requestedPath === "" ? "." : requestedPath;
        const kind = await sftp.exists(targetPath).catch(() => "d" as const);
        // A missing path fails in the listing below, with the server's own message.
        if (kind !== false && kind !== "d") throw new ValidationError("Not a directory");

        const list = await sftp.list(targetPath);
        const entries = list.map((item): FilesystemEntry => {
            const isDirectory = item.type === "d";
            return {
                name: item.name,
                type: isDirectory ? "directory" : "file",
                // SFTP returns names only, and servers reached over SSH use unix paths.
                path: path.posix.join(targetPath, item.name),
                ...(isDirectory ? {} : { size: item.size }),
                ...(item.modifyTime ? { modified: new Date(item.modifyTime).toISOString() } : {}),
            };
        });

        const parentPath = targetPath === "." ? "/" : path.posix.dirname(targetPath);
        return { currentPath: targetPath, parentPath, entries: sortEntries(entries) };
    } finally {
        await sftp.end().catch(() => undefined);
    }
}
