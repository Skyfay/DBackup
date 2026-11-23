import type { FileInfo, StorageAdapter, StorageReadOptions, StorageSession } from "@/lib/core/interfaces";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { stripTrailingDotsAndSpaces } from "@/lib/paths";
import { firstFolders } from "@/lib/core/job-folder";
import { logger } from "@/lib/logging/logger";
import { isFileTooLarge } from "@/lib/adapters/storage/common/read-limit";

const log = logger.child({ module: "StorageView" });

/**
 * How a tenant sees a destination. A destination its tenant shares with customers holds the backups
 * of each customer under `tenants/<tenant id>/`, and those of its own tenant where they always were.
 * Every path a caller passes is relative to what its tenant sees, and the view puts it where it
 * belongs: a customer reads and writes inside its folder alone, the tenant of the destination
 * everywhere but the folder of the customers. A destination nobody shares is its plain adapter.
 */

/** The folder at the root of a shared destination with one folder per customer. */
export const TENANTS_FOLDER = "tenants";

export type StorageViewMode =
    /** The tenant of a destination nobody shares: the adapter as it is. */
    | { kind: "own" }
    /** The tenant of a shared destination: everything but `tenants/`. */
    | { kind: "provider" }
    /** A customer of a shared destination: `tenants/<id>/` and nothing else. */
    | { kind: "customer"; tenantId: string };

/** The folder of a customer on a shared destination. */
export function tenantFolder(tenantId: string): string {
    return `${TENANTS_FOLDER}/${tenantId}`;
}

/** A name with its percent escapes read, the name itself when they do not read. */
function decoded(part: string): string {
    try {
        return decodeURIComponent(part);
    } catch {
        return part;
    }
}

/**
 * A path without a leading slash and without `.` segments. A `..` segment would leave the folder of
 * the view, so it is refused, and so is any other segment of dots and spaces alone, like `.. ` or
 * `...`, which Windows and the storages on it read as `..` once they drop the dots and spaces at
 * the end of a name. A segment like `%2e%2e` counts as well, since a storage that puts the path into
 * a URL may read it as `..`, and so does one that only holds such a part once read, like
 * `a%2F..%2Fb` or `%2E%2E%5Cb`, whose escaped separators such a storage reads as separators.
 */
export function cleanPath(remotePath: string): string {
    const parts = remotePath.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
    const onlyDots = (part: string) => /^[. ]+$/.test(part);
    if (parts.some((part) => onlyDots(part) || decoded(part).split(/[\\/]/).some(onlyDots))) throw new ValidationError(`The path ${remotePath} leaves its folder.`);
    return parts.join("/");
}

/**
 * Whether a part of a path names the folder of the customers. Some storages ignore the case, and
 * Windows drops dots and spaces at the end of a name, so `Tenants.` is that folder there too. The
 * upper case is compared as well, since a letter like `ſ` turns into `S` only that way.
 */
export function isTenantsSegment(part: string): boolean {
    const name = stripTrailingDotsAndSpaces(part);
    return name.toLowerCase() === TENANTS_FOLDER || name.toUpperCase() === TENANTS_FOLDER.toUpperCase();
}

/**
 * Whether a path lies in the folder of the customers, see `isTenantsSegment`. The first part counts
 * with its percent escapes read as well, like `cleanPath` reads them, since a storage that puts the
 * path into a URL reads `%74enants` or `tenants%2Facme` as that folder.
 */
const inTenantsFolder = (clean: string) => {
    const first = clean.split("/")[0];
    const firstDecoded = decoded(first).split(/[\\/]/).find((part) => part !== "" && part !== ".") ?? "";
    return isTenantsSegment(first) || isTenantsSegment(firstDecoded);
};

/**
 * What a customer reads when the storage of another tenant fails. The message of the storage names
 * its host, bucket or folders, which stay with the tenant that shares it, like the logs of a transfer.
 */
export const SHARED_STORAGE_FAILURE = "The destination did not answer. The tenant that shares it can see why.";

/** A failure of the storage as the view shows it: as it is, or without a word of the storage for a customer. */
function failure(mode: StorageViewMode, error: unknown): unknown {
    // A path the view refuses says nothing of the storage, and neither does a file past the limit of a read.
    if (mode.kind !== "customer" || error instanceof ValidationError || isFileTooLarge(error)) return error;
    log.warn("The storage of a destination shared with a tenant failed", { tenantId: mode.tenantId }, wrapError(error));
    return new Error(SHARED_STORAGE_FAILURE);
}

/** Runs a call of the storage and hands a failure on as the view shows it. */
async function guarded<T>(mode: StorageViewMode, work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (error) {
        throw failure(mode, error);
    }
}

/** The log of a transfer for the view: as it is, or none for a customer, since its lines name the storage. */
const logOf = <T>(mode: StorageViewMode, onLog: T | undefined): T | undefined => (mode.kind === "customer" ? undefined : onLog);

/**
 * Whether a job of this name would write into the folder of the customers of a shared destination.
 * A job writes into the folder its name gives, so `tenants` does and so does `tenants/acme`, and
 * `x/../tenants` too, whose first folder a path resolves to that one.
 */
export function isTenantsFolderName(name: string): boolean {
    return firstFolders(name).some(isTenantsSegment);
}

/** Whether a path names the root of what a view sees, like `""`, `/` or `./`, and no file in it. */
export function isRootPath(remotePath: string): boolean {
    return remotePath.replace(/\\/g, "/").split("/").every((part) => part === "" || part === ".");
}

/**
 * Refuses the root as the target of a delete or an upload. A storage like WebDAV deletes a folder
 * with everything in it, so the root of a customer would take its folder along, and the root of the
 * tenant that shares a destination the folder of every customer.
 */
export function assertFilePath(remotePath: string): void {
    if (isRootPath(remotePath)) throw new ValidationError("Name a file. The root of a destination is never deleted or written as a whole.");
}

/**
 * Refuses a path a caller names for a backup that could reach past the folder of the destination,
 * on every destination, also one nobody shares, whose view hands the path to the storage as it
 * is: an empty path, one that starts at a root with `/` or `\`, and one with a `..` segment, also
 * between backslashes or behind percent escapes, see `cleanPath`. The same rule as the download.
 */
export function assertBackupPath(remotePath: unknown): asserts remotePath is string {
    if (typeof remotePath !== "string" || remotePath.trim() === "") throw new ValidationError("Name a file.");
    for (const variant of [remotePath, decoded(remotePath)]) {
        if (/^[\\/]/.test(variant)) throw new ValidationError(`The path ${remotePath} starts at the root of the storage. Name it inside the destination.`);
        cleanPath(variant);
    }
}

/** Why `assertBackupPath` refuses a path, null for a path it takes. For a schema that checks the field. */
export function backupPathProblem(remotePath: unknown): string | null {
    try {
        assertBackupPath(remotePath);
        return null;
    } catch (error) {
        if (error instanceof ValidationError) return error.message;
        throw error;
    }
}

/** The path of a file on the destination for a delete or an upload, never the root of the view. */
function filePath(mode: StorageViewMode, remotePath: string): string {
    assertFilePath(remotePath);
    return innerPath(mode, remotePath);
}

/**
 * The path of a folder on the destination for removing it once empty. The root of a customer's view
 * is its own folder, which goes once its last backup is gone. The root of the tenant that shares the
 * destination is the root of the destination and never goes.
 */
function folderPath(mode: StorageViewMode, remotePath: string): string {
    if (mode.kind !== "customer") assertFilePath(remotePath);
    return innerPath(mode, remotePath);
}

/** The path on the destination for a path of the view. */
export function innerPath(mode: StorageViewMode, remotePath: string): string {
    if (mode.kind === "own") return remotePath;
    const clean = cleanPath(remotePath);
    if (mode.kind === "customer") return clean ? `${tenantFolder(mode.tenantId)}/${clean}` : tenantFolder(mode.tenantId);
    if (inTenantsFolder(clean)) {
        throw new ValidationError(`The folder ${TENANTS_FOLDER}/ holds the backups of the tenants this destination is shared with.`);
    }
    return clean;
}

/** The entries of a listing the view shows, with their paths as the view sees them. */
export function outerFiles(mode: StorageViewMode, files: FileInfo[]): FileInfo[] {
    if (mode.kind === "own") return files;
    if (mode.kind === "provider") {
        return files.filter((file) => {
            const clean = addressable(file.path);
            return clean !== null && !inTenantsFolder(clean);
        });
    }
    const prefix = `${tenantFolder(mode.tenantId)}/`;
    return files.flatMap((file) => {
        const clean = addressable(file.path);
        return clean?.startsWith(prefix) ? [{ ...file, path: clean.slice(prefix.length) }] : [];
    });
}

/** The clean path of a listed file, null for one the view could never name, like a folder called `...`. */
function addressable(remotePath: string): string | null {
    try {
        return cleanPath(remotePath);
    } catch {
        return null;
    }
}

function sessionView(session: StorageSession, mode: StorageViewMode): StorageSession {
    return {
        upload: (localPath, remotePath, onProgress, onLog, options) => {
            const inner = filePath(mode, remotePath);
            return guarded(mode, () => session.upload(localPath, inner, onProgress, logOf(mode, onLog), options));
        },
        ...(session.download
            ? {
                download: (remotePath: string, localPath: string, onProgress?: (processed: number, total: number) => void) => {
                    const inner = innerPath(mode, remotePath);
                    return guarded(mode, () => session.download!(inner, localPath, onProgress));
                },
            }
            : {}),
        close: () => guarded(mode, () => session.close()),
    };
}

/**
 * The adapter as a tenant sees the destination. It inherits everything of the adapter and maps
 * the path of every call that reads or writes a file. What walks or browses directories of a
 * source is left out, a destination of a view never serves as one. A customer gets no log line
 * and no message of the storage itself, see `SHARED_STORAGE_FAILURE`.
 */
export function storageView(adapter: StorageAdapter, mode: StorageViewMode): StorageAdapter {
    if (mode.kind === "own") return adapter;
    const at = (remotePath: string) => innerPath(mode, remotePath);
    type Config = Parameters<StorageAdapter["list"]>[0];
    type Log = Parameters<StorageAdapter["upload"]>[4];
    const view = Object.create(adapter) as StorageAdapter;
    Object.assign(view, {
        upload: (config: Config, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: Log, options?: Parameters<StorageAdapter["upload"]>[5]) => {
            const inner = filePath(mode, remotePath);
            return guarded(mode, () => adapter.upload(config, localPath, inner, onProgress, logOf(mode, onLog), options));
        },
        download: (config: Config, remotePath: string, localPath: string, onProgress?: (processed: number, total: number) => void, onLog?: Log) => {
            const inner = at(remotePath);
            return guarded(mode, () => adapter.download(config, inner, localPath, onProgress, logOf(mode, onLog)));
        },
        list: (config: Config, remotePath: string) => {
            const inner = at(remotePath);
            return guarded(mode, async () => outerFiles(mode, await adapter.list(config, inner)));
        },
        delete: (config: Config, remotePath: string) => {
            const inner = filePath(mode, remotePath);
            return guarded(mode, () => adapter.delete(config, inner));
        },
        deleteEmptyFolder: adapter.deleteEmptyFolder
            ? (config: Config, remotePath: string) => {
                const inner = folderPath(mode, remotePath);
                return guarded(mode, () => adapter.deleteEmptyFolder!(config, inner));
            }
            : undefined,
        read: adapter.read
            ? (config: Config, remotePath: string, options?: StorageReadOptions) => {
                const inner = at(remotePath);
                return guarded(mode, () => adapter.read!(config, inner, options));
            }
            : undefined,
        readBytes: adapter.readBytes
            ? (config: Config, remotePath: string, options?: StorageReadOptions) => {
                const inner = at(remotePath);
                return guarded(mode, () => adapter.readBytes!(config, inner, options));
            }
            : undefined,
        verifyChecksum: adapter.verifyChecksum
            ? (config: Config, remotePath: string, checksums: { sha256?: string; md5?: string }) => {
                const inner = at(remotePath);
                return guarded(mode, () => adapter.verifyChecksum!(config, inner, checksums));
            }
            : undefined,
        downloadRange: adapter.downloadRange
            ? (config: Config, remotePath: string, start: number, end: number) => {
                const inner = at(remotePath);
                return guarded(mode, () => adapter.downloadRange!(config, inner, start, end));
            }
            : undefined,
        openSession: adapter.openSession
            ? async (config: Config, onLog?: Parameters<NonNullable<StorageAdapter["openSession"]>>[1], options?: { concurrency?: number }) =>
                sessionView(await guarded(mode, () => adapter.openSession!(config, logOf(mode, onLog), options)), mode)
            : undefined,
        listTree: undefined,
        downloadDirectory: undefined,
        createSymlink: undefined,
        browseDirectories: undefined,
    });
    return view;
}
