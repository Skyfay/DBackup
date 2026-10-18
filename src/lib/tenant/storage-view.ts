import type { FileInfo, StorageAdapter, StorageSession } from "@/lib/core/interfaces";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { stripTrailingDotsAndSpaces } from "@/lib/paths";
import { logger } from "@/lib/logging/logger";

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

/**
 * A path without a leading slash and without `.` segments. A `..` segment would leave the folder of
 * the view, so it is refused, and so is any other segment of dots and spaces alone, like `.. ` or
 * `...`, which Windows and the storages on it read as `..` once they drop the dots and spaces at
 * the end of a name.
 */
export function cleanPath(remotePath: string): string {
    const parts = remotePath.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
    if (parts.some((part) => /^[. ]+$/.test(part))) throw new ValidationError(`The path ${remotePath} leaves its folder.`);
    return parts.join("/");
}

/**
 * Whether a part of a path names the folder of the customers. Some storages ignore the case, and
 * Windows drops dots and spaces at the end of a name, so `Tenants.` is that folder there too. The
 * upper case is compared as well, since a letter like `ſ` turns into `S` only that way.
 */
function isTenantsSegment(part: string): boolean {
    const name = stripTrailingDotsAndSpaces(part);
    return name.toLowerCase() === TENANTS_FOLDER || name.toUpperCase() === TENANTS_FOLDER.toUpperCase();
}

/** Whether a path lies in the folder of the customers, see `isTenantsSegment`. */
const inTenantsFolder = (clean: string) => isTenantsSegment(clean.split("/")[0]);

/**
 * What a customer reads when the storage of another tenant fails. The message of the storage names
 * its host, bucket or folders, which stay with the tenant that shares it, like the logs of a transfer.
 */
export const SHARED_STORAGE_FAILURE = "The destination did not answer. The tenant that shares it can see why.";

/** A failure of the storage as the view shows it: as it is, or without a word of the storage for a customer. */
function failure(mode: StorageViewMode, error: unknown): unknown {
    // A path the view refuses says nothing of the storage.
    if (mode.kind !== "customer" || error instanceof ValidationError) return error;
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
 * A job writes into the folder its name gives, so `tenants` does and so does `tenants/acme`.
 */
export function isTenantsFolderName(name: string): boolean {
    const first = name.trim().replace(/\\/g, "/").split("/").find((part) => part !== "" && part !== ".");
    return first !== undefined && isTenantsSegment(first.trim());
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

/** The path of a file on the destination for a delete or an upload, never the root of the view. */
function filePath(mode: StorageViewMode, remotePath: string): string {
    assertFilePath(remotePath);
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
        read: adapter.read
            ? (config: Config, remotePath: string) => {
                const inner = at(remotePath);
                return guarded(mode, () => adapter.read!(config, inner));
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
