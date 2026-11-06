import { StorageAdapter, StorageSession, FileInfo, DirectoryBrowseEntry, SnapshotHandle, StorageReadOptions } from "@/lib/core/interfaces";
import { probeSnapshotSupport, createShadowCopy, releaseShadowCopy, findOrphanedShadowCopies } from "./smb-vss";
import { SMBSchema } from "@/lib/adapters/definitions";
import { isSmbAddress, isSmbCommandSafe, SMB_ADDRESS_HINT, SMB_LOGIN_HINT, smbCommandRefusal, smbLoginHasPercent, smbResolveOptions } from "@/lib/adapters/smb-address";
import SambaClient from "samba-client";
import path from "path";
import fs from "fs/promises";
import { withPrivateTempDir, writeNewFile } from "@/lib/private-temp-dir";
import { runSmbclient } from "./smb-run";
import { assertReadSize, FileTooLargeError, isFileTooLarge, readLimitOf, textOf } from "@/lib/adapters/storage/common/read-limit";
import { createListingGuard, ListingTooLargeError } from "@/lib/adapters/storage/common/listing-limits";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ adapter: "smb" });

function sanitizeSmbError(error: unknown, password?: string): Error {
    const original = error instanceof Error ? error : new Error(String(error));
    if (!password) return original;
    const sanitized = original.message.split(password).join("****");
    const out = new Error(sanitized);
    out.stack = original.stack?.split(password).join("****");
    return out;
}

/**
 * What smbclient prints when the folder of a `dir` is not there: OBJECT_NAME_NOT_FOUND for a
 * missing last folder, OBJECT_PATH_NOT_FOUND for a missing folder above it, and NO_SUCH_FILE
 * when the pattern matches nothing. Each starts a line of the output, followed by "listing".
 */
const SMB_NOT_FOUND = /^NT_STATUS_(?:OBJECT_NAME_NOT_FOUND|OBJECT_PATH_NOT_FOUND|NO_SUCH_FILE)\b/m;

/**
 * Whether smbclient failed because the folder it listed does not exist. Read from what
 * smbclient printed, never from the message, which also holds the command and the path in it.
 * A refused login, a missing share or an unreachable server prints other codes.
 */
function isSmbNotFound(error: unknown): boolean {
    const output = error as { all?: unknown; stdout?: unknown; stderr?: unknown } | null;
    return [output?.all, output?.stdout, output?.stderr]
        .some((text) => typeof text === "string" && SMB_NOT_FOUND.test(text));
}

interface SMBConfig {
    address: string;
    username: string;
    password?: string;
    domain?: string;
    maxProtocol: string;
    pathPrefix?: string;
}

/** An entry of a folder as samba-client reads it from the output of `dir`. */
interface SmbListItem {
    name: string;
    type: string;
    size: number;
    modifyTime: Date;
}

/**
 * The commands of samba-client this adapter runs. Every path that goes into the command line of
 * smbclient is checked first, see `smbCommandRefusal`, so no name of a share, an archive, a job or
 * a template ever runs a second command.
 */
interface SmbClient {
    sendFile(localPath: string, remotePath: string): Promise<unknown>;
    getFile(remotePath: string, localPath: string): Promise<unknown>;
    deleteFile(remotePath: string): Promise<unknown>;
    mkdir(remotePath: string, cwd: string): Promise<unknown>;
    list(remotePath: string): Promise<SmbListItem[]>;
}

/** Refuses a path smbclient would read as part of its command, see `smbCommandRefusal`. */
function assertCommandSafe(value: string): void {
    const refusal = smbCommandRefusal(value);
    if (refusal) throw new Error(refusal);
}

/** The argv of samba-client without its `--password <secret>` pair, see `smb-run.ts`. */
export function withoutPasswordArgs(args: readonly string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--password") {
            i++;
            continue;
        }
        out.push(args[i]);
    }
    return out;
}

/**
 * samba-client with the resolve options of the config on every smbclient call, `SMB_RESOLVE_OPTIONS`
 * for a tenant that blocks the local network, so smbclient finds the server only where the local
 * network check of that tenant looked, see `smbResolveOptions`, and with the password in the
 * environment of smbclient instead of its argv, where anyone on the machine reads it, see
 * `smb-run.ts`. samba-client still gets the password, so it leaves out `-N`, which would set an
 * empty one over it.
 */
class ResolvingSambaClient extends SambaClient {
    private readonly secret: string | undefined;
    private readonly signal: AbortSignal | undefined;
    private readonly resolveOptions: readonly string[];

    constructor(options: ConstructorParameters<typeof SambaClient>[0], resolveOptions: readonly string[], signal?: AbortSignal) {
        super(options);
        this.secret = options.password;
        this.signal = signal;
        this.resolveOptions = resolveOptions;
    }

    getSmbClientArgs(smbCommand: string, smbCommandArgs: string | string[]): string[] {
        const base = (SambaClient.prototype as unknown as { getSmbClientArgs(command: string, args: string | string[]): string[] }).getSmbClientArgs;
        return [...withoutPasswordArgs(base.call(this, smbCommand, smbCommandArgs)), ...this.resolveOptions];
    }

    // An instance member, since samba-client declares it as one. Every command of samba-client runs through it.
    execute = async (smbCommand: string, smbCommandArgs: string | string[], workingDir?: string): Promise<string> =>
        runSmbclient(this.getSmbClientArgs(smbCommand, smbCommandArgs), { cwd: workingDir, password: this.secret, signal: this.signal });
}

/**
 * Creates a client for the share. samba-client quotes each path without escaping it and hands
 * smbclient one command line, so each path is checked here before any command is built: the
 * remote path, and of the local file the part samba-client puts into the command.
 */
function createClient(config: SMBConfig, signal?: AbortSignal): SmbClient {
    // smbclient takes the address as an argument of its own, so one of another form could reach
    // it as an option or dial another host than the local network check saw, see `smb-address.ts`.
    if (!isSmbAddress(config.address)) throw new Error(`The share address does not read. ${SMB_ADDRESS_HINT}`);
    // samba-client passes the user as `-U <user>`, and smbclient reads a `%` there as the start of a
    // password that wins over `PASSWD`, see `smbLoginHasPercent`. Checked here as well as on save,
    // since a config or a credential profile may predate that check.
    if (smbLoginHasPercent(config.username) || smbLoginHasPercent(config.domain)) throw new Error(SMB_LOGIN_HINT);
    const client = new ResolvingSambaClient({
        address: config.address.trim(),
        username: config.username || "guest",
        password: config.password,
        domain: config.domain,
        maxProtocol: config.maxProtocol || "SMB3",
    }, smbResolveOptions(config), signal);
    return {
        async sendFile(localPath, remotePath) {
            // samba-client runs `put` from the folder of the file with its name alone.
            assertCommandSafe(path.basename(localPath));
            assertCommandSafe(remotePath);
            return client.sendFile(localPath, remotePath);
        },
        async getFile(remotePath, localPath) {
            assertCommandSafe(remotePath);
            assertCommandSafe(localPath);
            return client.getFile(remotePath, localPath);
        },
        async deleteFile(remotePath) {
            assertCommandSafe(remotePath);
            return client.deleteFile(remotePath);
        },
        async mkdir(remotePath, cwd) {
            assertCommandSafe(remotePath);
            return client.mkdir(remotePath, cwd);
        },
        async list(remotePath) {
            assertCommandSafe(remotePath);
            return client.list(remotePath);
        },
    };
}

/**
 * Joins the pathPrefix with a relative path using forward slashes. A folder setting or a path that
 * smbclient would read as part of its command is refused, see `smbCommandRefusal`.
 */
function resolvePath(config: SMBConfig, relativePath: string): string {
    if (config.pathPrefix) assertCommandSafe(config.pathPrefix);
    assertCommandSafe(relativePath);
    if (config.pathPrefix) {
        return config.pathPrefix.replace(/\\/g, "/") + "/" + relativePath.replace(/\\/g, "/");
    }
    return relativePath.replace(/\\/g, "/");
}

/**
 * Whether a name of a listing is one name of one folder. The server answers `dir` with whatever it
 * likes, and a name with a `/` or `\`, or of dots alone like `..`, would make the walk read another
 * folder than the one it lists and the collection name a file outside the folder of the source.
 */
function plainEntryName(name: string): boolean {
    return name !== "" && !/[\\/]/.test(name) && !/^\.+$/.test(name);
}

/**
 * Whether an entry of a listing can be read further. A name with a semicolon, a double quote or a
 * control character, which Windows allows for a semicolon, would break the command of every later
 * read, and a name that is no plain name of the folder (`plainEntryName`) would lead elsewhere, so
 * the entry is left out and named in the log.
 */
function readableEntry(config: SMBConfig, folder: string, name: string): boolean {
    if (isSmbCommandSafe(name) && plainEntryName(name)) return true;
    log.warn("Skipped an SMB entry whose name smbclient cannot take in a command or that is no plain name", { address: config.address, folder, name: JSON.stringify(name) });
    return false;
}

/**
 * Creates every folder of a remote path below the folder setting, one after the other, since
 * smbclient creates no missing parents: a first backup to `tenants/<id>/<job>/` needs three. A
 * folder that exists already answers with an error, which is ignored, and a folder that cannot be
 * made shows in the error of the upload. `made` keeps the folders made in this session.
 */
async function ensureDir(client: SmbClient, config: SMBConfig, remotePath: string, made: Set<string>): Promise<void> {
    const parts = path.posix.dirname(remotePath.replace(/\\/g, "/")).split("/").filter((part) => part !== "" && part !== ".");
    for (let depth = 1; depth <= parts.length; depth++) {
        const dir = resolvePath(config, parts.slice(0, depth).join("/"));
        if (made.has(dir)) continue;
        try {
            await client.mkdir(dir, "/");
        } catch {
            // The folder may exist already.
        }
        made.add(dir);
    }
}

/**
 * Performs a single upload on an already-created SambaClient. The directory
 * cache prevents redundant mkdir calls when reused across multiple uploads
 * in the same session.
 *
 * Note: the underlying `samba-client` library still spawns a new `smbclient`
 * subprocess for every `sendFile`/`mkdir` call, so the per-call TCP/SMB
 * negotiation overhead remains. Full connection reuse would require switching
 * to a different SMB library.
 */
async function performSmbUpload(
    client: SmbClient,
    config: SMBConfig,
    localPath: string,
    remotePath: string,
    onProgress: ((percent: number) => void) | undefined,
    onLog: ((msg: string, level?: LogLevel, type?: LogType, details?: string) => void) | undefined,
    dirCache: Set<string>
): Promise<boolean> {
    try {
        const destination = resolvePath(config, remotePath);
        await ensureDir(client, config, remotePath, dirCache);

        if (onLog) onLog(`Starting SMB upload to: ${destination}`, "info", "storage");

        await client.sendFile(localPath, destination);

        if (onProgress) onProgress(100);
        if (onLog) onLog("SMB upload completed successfully", "info", "storage");
        return true;
    } catch (error: unknown) {
        const safe = sanitizeSmbError(error, config.password);
        log.error("SMB upload failed", { address: config.address, remotePath }, wrapError(safe));
        if (onLog) onLog(`SMB upload failed: ${safe.message}`, "error", "storage", safe.stack);
        return false;
    }
}

/** How often a read checks how far smbclient got, see `readCappedBytes`. */
const SMB_READ_WATCH_MS = 100;

/**
 * The bytes of a file, at most the limit of the read, see `read-limit.ts`. smbclient writes only
 * into a file and cannot stop at a size, so the file is watched while it grows and smbclient is
 * killed once it passes the limit. Null when the file is not there.
 */
async function readCappedBytes(config: SMBConfig, remotePath: string, options?: StorageReadOptions): Promise<Buffer | null> {
    const limit = readLimitOf(options);
    try {
        return await withPrivateTempDir("smb-read-", async (dir) => {
            const tmpPath = path.join(dir, "read");
            const controller = new AbortController();
            let tooLarge = false;
            const check = async () => {
                try {
                    if ((await fs.stat(tmpPath)).size > limit && !controller.signal.aborted) {
                        tooLarge = true;
                        controller.abort();
                    }
                } catch { /* not written yet */ }
            };
            const watch = setInterval(() => void check(), SMB_READ_WATCH_MS);
            try {
                const client = createClient(config, controller.signal);
                await client.getFile(resolvePath(config, remotePath), tmpPath);
            } catch (error) {
                if (tooLarge) throw new FileTooLargeError(limit);
                throw error;
            } finally {
                clearInterval(watch);
            }
            const handle = await fs.open(tmpPath, "r");
            try {
                assertReadSize((await handle.stat()).size, limit);
                return await handle.readFile();
            } finally {
                await handle.close();
            }
        });
    } catch (error) {
        if (isFileTooLarge(error)) throw error;
        // Quietly fail if file not found (expected for missing .meta.json)
        return null;
    }
}

export const SMBAdapter: StorageAdapter = {
    id: "smb",
    type: "storage",
    name: "SMB (Samba)",
    configSchema: SMBSchema,
    credentials: { primary: "USERNAME_PASSWORD" },

    async openSession(config: SMBConfig, onLog?): Promise<StorageSession> {
        const client = createClient(config);
        if (onLog) onLog(`Connecting to SMB share ${config.address}`, "info", "storage");
        const dirCache = new Set<string>();
        return {
            upload: (localPath, remotePath, onProgress, uploadLog) =>
                performSmbUpload(client, config, localPath, remotePath, onProgress, uploadLog ?? onLog, dirCache),
            close: async () => { },
        };
    },

    async upload(config: SMBConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        const client = createClient(config);
        if (onLog) onLog(`Connecting to SMB share ${config.address}`, "info", "storage");
        return performSmbUpload(client, config, localPath, remotePath, onProgress, onLog, new Set());
    },

    async download(config: SMBConfig, remotePath: string, localPath: string, _onProgress?: (processed: number, total: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        try {
            const client = createClient(config);
            const source = resolvePath(config, remotePath);

            if (onLog) onLog(`Downloading from SMB: ${source}`, "info", "storage");

            await client.getFile(source, localPath);
            return true;
        } catch (error: unknown) {
            const safe = sanitizeSmbError(error, config.password);
            log.error("SMB download failed", { address: config.address, remotePath }, wrapError(safe));
            if (onLog) onLog(`SMB download failed: ${safe.message}`, "error", "storage", safe.stack);
            return false;
        }
    },

    async read(config: SMBConfig, remotePath: string, options?: StorageReadOptions): Promise<string | null> {
        return textOf(await readCappedBytes(config, remotePath, options));
    },

    readBytes: readCappedBytes,

    async browseDirectories(config: SMBConfig, subPath: string = ""): Promise<DirectoryBrowseEntry[]> {
        try {
            const client = createClient(config);
            const normalize = (p: string) => p.replace(/\\/g, "/");

            const prefix = config.pathPrefix ? normalize(config.pathPrefix) : "";
            const base = prefix
                ? prefix + (subPath ? "/" + normalize(subPath) : "")
                : normalize(subPath);

            // smbclient's "dir" needs a glob: "folder/*" lists the folder's contents,
            // while "folder" alone would only match the entry itself.
            const items = await client.list(base ? base + "/*" : "*");

            return items
                // The attribute string carries "D" for a directory, alongside flags like
                // "A" (archive) or "H" (hidden), so it is tested rather than compared.
                .filter((item) =>
                    item.type.includes("D") && item.name !== "." && item.name !== ".."
                    && readableEntry(config, base, item.name))
                .map((item) => ({
                    name: item.name,
                    path: subPath ? `${subPath}/${item.name}` : item.name,
                }));
        } catch (error: unknown) {
            const safe = sanitizeSmbError(error, config.password);
            log.error("SMB browseDirectories failed", { address: config.address, subPath }, wrapError(safe));
            throw safe;
        }
    },

    async list(config: SMBConfig, dir: string = ""): Promise<FileInfo[]> {
        try {
            const client = createClient(config);

            const normalize = (p: string) => p.replace(/\\/g, "/");

            const prefix = config.pathPrefix ? normalize(config.pathPrefix) : "";
            const startDir = prefix
                ? prefix + (dir ? "/" + normalize(dir) : "")
                : (dir || "");

            const files: FileInfo[] = [];
            // The share may belong to a customer. Every entry, a folder too, passes the guard as it
            // arrives, so a tree of any size, or a loop of folders on the server that the names
            // alone cannot show, ends the walk there, see `listing-limits.ts`.
            const guard = createListingGuard();

            const walk = async (currentDir: string) => {
                let items: SmbListItem[];
                try {
                    // smbclient's "dir" command requires a glob pattern to list directory contents.
                    // "dir folder" matches the entry itself, "dir folder/*" lists its contents.
                    // For root listing (empty currentDir), "*" lists everything in the share root.
                    const listPath = currentDir ? currentDir + "/*" : "*";
                    items = await client.list(listPath);
                } catch (error: unknown) {
                    if (currentDir === startDir) {
                        // A subfolder nothing was written to yet is not there. It lists as empty,
                        // like on the other destinations.
                        if (dir !== "" && isSmbNotFound(error)) return;
                        // Any other failure, and every failure of the root, means the share is
                        // unreachable or inaccessible. Propagate to trigger the DB fallback in the stats cache.
                        throw sanitizeSmbError(error, config.password);
                    }
                    // Sub-directory listing failure (e.g. permission denied on one folder): skip silently.
                    return;
                }

                for (const item of items) {
                    // Skip . and .. entries
                    if (item.name === "." || item.name === "..") continue;
                    // A name no later command can carry, or one with a separator or of dots alone,
                    // is named in the log and left out.
                    if (!readableEntry(config, currentDir, item.name)) continue;

                    const fullPath = currentDir
                        ? normalize(currentDir) + "/" + item.name
                        : item.name;
                    guard.add(fullPath);

                    if (item.type.includes("D")) {
                        await walk(fullPath);
                    } else {
                        // Calculate relative path (strip prefix)
                        let relativePath = normalize(fullPath);
                        if (prefix && relativePath.startsWith(prefix)) {
                            relativePath = relativePath.substring(prefix.length);
                        }
                        if (relativePath.startsWith("/")) relativePath = relativePath.substring(1);

                        files.push({
                            name: item.name,
                            path: relativePath,
                            size: item.size,
                            lastModified: item.modifyTime,
                        });
                    }
                }
            };

            await walk(startDir);
            return files;
        } catch (error: unknown) {
            if (error instanceof ListingTooLargeError) {
                log.error("SMB list failed", { address: config.address, dir }, wrapError(error));
                throw error;
            }
            const safe = sanitizeSmbError(error, config.password);
            log.error("SMB list failed", { address: config.address, dir }, wrapError(safe));
            throw safe;
        }
    },

    async delete(config: SMBConfig, remotePath: string): Promise<boolean> {
        try {
            const client = createClient(config);
            const target = resolvePath(config, remotePath);

            await client.deleteFile(target);
            return true;
        } catch (error: unknown) {
            const safe = sanitizeSmbError(error, config.password);
            log.error("SMB delete failed", { address: config.address, remotePath }, wrapError(safe));
            return false;
        }
    },

    async ping(config: SMBConfig): Promise<{ success: boolean; message: string }> {
        const client = createClient(config);
        try {
            const listPath = config.pathPrefix ? `${config.pathPrefix}/*` : "*";
            await client.list(listPath);
            return { success: true, message: "Connection successful" };
        } catch (error: unknown) {
            const safe = sanitizeSmbError(error, config.password);
            return { success: false, message: `SMB Connection failed: ${safe.message}` };
        }
    },

    async test(config: SMBConfig): Promise<{ success: boolean; message: string }> {
        const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
        const testFileName = `.dbackup/test/connection-test-smb-${ts}`;
        if (!isSmbAddress(config.address)) return { success: false, message: `The share address does not read. ${SMB_ADDRESS_HINT}` };
        if (smbLoginHasPercent(config.username) || smbLoginHasPercent(config.domain)) return { success: false, message: SMB_LOGIN_HINT };
        const prefixRefusal = config.pathPrefix ? smbCommandRefusal(config.pathPrefix) : null;
        if (prefixRefusal) return { success: false, message: prefixRefusal };
        const client = createClient(config);
        const destination = resolvePath(config, testFileName);

        try {
            // Ensure test subfolder exists (two-step: samba-client does not handle nested mkdir)
            await client.mkdir(resolvePath(config, '.dbackup'), '/').catch(() => {});
            await client.mkdir(resolvePath(config, '.dbackup/test'), '/').catch(() => {});

            await withPrivateTempDir("smb-test-", async (dir) => {
                // A file of a folder of its own, see `withPrivateTempDir`.
                const tmpPath = path.join(dir, `connection-test-smb-${ts}`);
                await writeNewFile(tmpPath, "Connection Test");

                // 1. Write Test
                await client.sendFile(tmpPath, destination);
            });

            // 2. Delete Test
            await client.deleteFile(destination);

            return { success: true, message: "Connection successful (Write/Delete verified)" };
        } catch (error: unknown) {
            const safe = sanitizeSmbError(error, config.password);
            return { success: false, message: `SMB Connection failed: ${safe.message}` };
        } finally {
            await client.deleteFile(destination).catch(() => {});
        }
    },

    // ── Shadow copies (MS-FSRVP) ─────────────────────────────────────────────
    // Only useful for a directory source: snapshotting the place backups are written to
    // gains nothing. The role check lives in the form and the API, not here - the adapter
    // just exposes the capability.

    async supportsSnapshot(config: SMBConfig): Promise<{ supported: boolean; message: string }> {
        return probeSnapshotSupport(config);
    },

    async createSnapshot(config: SMBConfig): Promise<SnapshotHandle> {
        return createShadowCopy(config);
    },

    async releaseSnapshot(config: SMBConfig, handle: SnapshotHandle): Promise<void> {
        return releaseShadowCopy(config, handle);
    },

    async findOrphanedSnapshots(config: SMBConfig): Promise<SnapshotHandle[]> {
        return findOrphanedShadowCopies(config);
    },
};
