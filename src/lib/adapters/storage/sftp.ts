import {
    StorageAdapter,
    StorageSession,
    FileInfo,
    DirectoryBrowseEntry,
    ListTreeOptions,
    ListTreeResult,
    PrunedDirectory,
} from "@/lib/core/interfaces";
import { normalizeSshPrivateKey } from "@/lib/transport/pkcs8-compat";
import { createConnectionPool } from "@/lib/adapters/storage/common/connection-pool";
import { mapWithConcurrency } from "@/lib/concurrency";
import { canPruneDirectory } from "@/lib/exclude-patterns";
import { SFTPSchema } from "@/lib/adapters/definitions";
import Client from "ssh2-sftp-client";
import { Readable } from "stream";
import path from "path";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ adapter: "sftp" });

interface SFTPConfig {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    pathPrefix?: string;
}

/**
 * Keeps a connection from outliving the network it runs over.
 *
 * ssh2 disables both of these by default: no keepalive, and the socket's own inactivity
 * timeout set to 0. `readyTimeout` covers the handshake and is cleared once the connection is
 * ready. So a connection that stops being carried - a NAT entry expiring, a firewall dropping
 * its state, a server that stops answering without closing - produces no event at all, and
 * the request waiting on it waits forever. That is not theoretical: it is how a file backup
 * came to sit on one directory listing for four hours.
 *
 * With keepalive on, ssh2 pings every interval and destroys the socket after
 * `keepaliveCountMax` unanswered ones, which surfaces as a normal connection error the
 * transfer can report. Same values as `src/lib/ssh/ssh-client.ts`, which already did this.
 */
const CONNECTION_TUNING = {
    readyTimeout: 20000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
} as const;

/** How long a polite disconnect may take before the socket is dropped outright. */
const DISCONNECT_TIMEOUT_MS = 5000;

/**
 * Opens an SFTP session.
 *
 * Exported because the Rsync adapter needs it too: rsync here is always carried over SSH
 * with the same credentials, and SFTP is a subsystem of that same SSH server - which is
 * what lets an rsync destination serve byte ranges despite rsync itself having no such
 * concept.
 */
export const connectSFTP = async (config: SFTPConfig, onDisconnect?: (reason: string) => void): Promise<Client> => {
    // PKCS#8 encrypted keys (BEGIN ENCRYPTED PRIVATE KEY) are not supported by
    // ssh2-sftp-client. Decrypt them in-memory via Node.js crypto first.
    let privateKey = config.privateKey;
    if (privateKey?.includes("BEGIN ENCRYPTED PRIVATE KEY")) {
        if (!config.passphrase) {
            throw new Error("This private key is passphrase-protected. Please provide the passphrase.");
        }
        privateKey = normalizeSshPrivateKey(privateKey, config.passphrase);
    }
    // Second constructor argument, not an afterthought: SftpClient is not an EventEmitter, so
    // these callbacks are the only supported way to hear that a connection dropped - which a
    // pool must know before handing it to the next transfer. Passing them also replaces the
    // library's defaults, which write to the console directly.
    const sftp = new Client('sftp', {
        error: (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            // Debug, not warn: a connection dropping is expected during teardown, and the
            // transfer that cared about it reports its own failure.
            log.debug('SFTP connection error', { host: config.host, error: message });
            onDisconnect?.(message);
        },
        end: () => onDisconnect?.('the connection ended'),
        close: () => onDisconnect?.('the connection closed'),
    });
    try {
        await sftp.connect({
            host: config.host,
            port: config.port,
            username: config.username,
            password: config.password,
            privateKey,
            // passphrase only needed for non-PKCS#8-encrypted keys
            passphrase: privateKey !== config.privateKey ? undefined : config.passphrase,
            ...CONNECTION_TUNING,
        });
        return sftp;
    } catch (error) {
        // Do not leave an orphaned SSH socket when a handshake fails before the
        // client becomes usable; this is especially important before a retry.
        await endSftpClient(sftp);
        throw error;
    }
};

/**
 * Closes a connection without ever waiting indefinitely for it.
 *
 * `end()` in ssh2-sftp-client resolves only from the `'close'` event, and ssh2's `end()` does
 * a graceful `sock.end()` - a FIN, not a destroy. A Node socket emits `'close'` only once
 * both directions are closed, so if the peer never answers with its own FIN the promise stays
 * pending forever. Keepalive does not rescue this: ssh2 stops the keepalive timer as soon as
 * the socket is no longer writable, which `end()` has just made true.
 *
 * Every caller here closes in a `finally`, so a hanging disconnect stalls the whole backup
 * after its real work is already done. Bounding it costs at most one dropped socket, which
 * the server cleans up on its own.
 */
export async function endSftpClient(sftp: Client): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            sftp.end(),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, DISCONNECT_TIMEOUT_MS);
                timer.unref?.();
            }),
        ]);
    } catch {
        // A disconnect that fails has still ended the connection as far as we are concerned.
    } finally {
        if (timer) clearTimeout(timer);
        // Reaching past the wrapper on purpose: it exposes no way to drop a connection that
        // will not close politely, and leaving the socket open would leak a file descriptor
        // per backup run.
        const raw = (sftp as unknown as { client?: { destroy?: () => void } }).client;
        try { raw?.destroy?.(); } catch { /* already gone */ }
    }
}

/** A pooled connection plus whether it is still usable, kept together so the pool can check it. */
interface PooledClient {
    client: Client;
    alive: boolean;
}

/** One retry for handshake reset/timeout; never retry authentication or permission failures. */
async function connectSFTPForSource(config: SFTPConfig): Promise<Client> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            return await connectSFTP(config);
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            if (attempt === 2 || !/handshake|timed? out|ETIMEDOUT|ECONNRESET|connection reset/i.test(message)) {
                throw error;
            }
        }
    }
    throw lastError;
}

/** How many sibling names to name in a diagnostic - enough to recognise the place, short enough to read. */
const ROOT_HINT_ENTRIES = 12;

/**
 * Keeps many SFTP requests in flight per file, which is what decides throughput on this protocol.
 *
 * A plain stream transfer (put/get) sends one READ or WRITE and waits for the server to
 * acknowledge it before sending the next - see ssh2's SFTP WriteStream._write and
 * ReadStream._read, both of which issue a single request per callback. One 64 KB request per
 * round trip caps a transfer at 64 KB / RTT no matter how fast the link is: roughly 3 MB/s over
 * a 20 ms path, and no faster for a 10 Gbit line. Parallel *files* hide that while many are
 * running, then the last large file drops back to the single-stream ceiling.
 *
 * fastGet/fastPut keep `concurrency` chunks outstanding instead, so the ceiling becomes
 * concurrency x chunkSize / RTT. The defaults (64 x 32 KB = 2 MB in flight) lift the same 20 ms
 * path to ~100 MB/s, past what the link or the disk will give. Left at the library's defaults
 * deliberately: 32 KB is the packet size every SFTP server accepts, and raising it risks servers
 * that reject larger packets for a ceiling that is already far above the bottleneck.
 */
const TRANSFER_TUNING = { concurrency: 64, chunkSize: 32768 } as const;

/**
 * Creates a directory, treating "someone else just created it" as success.
 *
 * With several files being transferred at once, two of them landing in the same new folder race:
 * both see it missing, both call mkdir, one loses. Servers report that as a plain failure - the
 * SFTP status codes do not distinguish "exists" from "denied", and OpenSSH's sftp-server answers
 * with a permission error - so the message is indistinguishable from a real rights problem, which
 * is exactly how it turned up: one file out of 130 failing with "permission denied" on a folder
 * the other 129 wrote into happily. Re-reading the directory afterwards is the only reliable way
 * to tell a lost race from an actual error.
 */
async function mkdirIdempotent(sftp: Client, dir: string): Promise<void> {
    try {
        await sftp.mkdir(dir);
    } catch (error) {
        if (await sftp.exists(dir) !== 'd') throw error;
    }
}

/**
 * Rewrites a path that failed because SFTP starts somewhere below the filesystem root.
 *
 * A chrooted SFTP service shows the confinement directory as "/", so a path written from the
 * real filesystem's point of view carries leading segments that do not exist inside it -
 * /volume1/Transfer/restore on a Synology whose SFTP root is /volume1. The give-away is that
 * one of the later segments *is* one of the folders visible at the login directory, which makes
 * the correction computable rather than something for the user to deduce.
 *
 * The outermost match wins, so as much of the original path as possible is kept, and every
 * candidate is confirmed against the server before being offered. A name matching by coincidence
 * would otherwise send the user off to try a path that fails the same way - the check costs one
 * stat and turns the guess into something known to exist.
 */
async function suggestRelativePath(
    sftp: Client,
    prefix: string,
    visibleFolders: readonly string[]
): Promise<string | undefined> {
    const segments = prefix.split('/').filter(Boolean);
    // Only leading segments can be the surplus - a match at 0 means the path was already correct
    // and something else is wrong, so there is nothing to suggest.
    for (let i = 1; i < segments.length; i++) {
        if (!visibleFolders.some((f) => f.toLowerCase() === segments[i].toLowerCase())) continue;
        const candidate = `/${segments.slice(i).join('/')}`;
        if (await sftp.exists(candidate) === 'd') return candidate;
    }
    return undefined;
}

/**
 * Explains where an unreachable path went wrong, from the server's own point of view.
 *
 * "Path not reachable" leaves two very different causes indistinguishable: SFTP may be confined
 * to a directory below the filesystem root (so an absolute path cannot resolve at all), or the
 * account may simply lack access to one segment. Walking the prefix top-down finds the exact
 * segment that stops being visible, and the login directory plus its contents show what the
 * account can see - which is the difference between "type a shorter path" and "grant access to
 * that folder". Where those two halves line up, the corrected path is named outright.
 *
 * Best-effort throughout: a server that refuses these probes must not replace the real error
 * with a diagnostic failure.
 */
async function describeSftpRoot(sftp: Client, prefix: string): Promise<string> {
    const parts: string[] = [];

    try {
        const segments = prefix.split('/').filter(Boolean);
        let walked = prefix.startsWith('/') ? '' : '.';
        let deepest = '';
        let missing = '';
        for (const segment of segments) {
            walked = `${walked}/${segment}`;
            if (await sftp.exists(walked) === 'd') { deepest = walked; continue; }
            missing = walked;
            break;
        }
        if (missing && deepest) {
            parts.push(`"${deepest}" is reachable, but "${missing}" inside it is not.`);
        } else if (missing) {
            parts.push(`The path is already unreachable at "${missing}".`);
        }
    } catch { /* Probing is optional - fall through to the login directory hint. */ }

    try {
        const root = await sftp.cwd();
        const entries = await sftp.list(root);
        const folders = entries.filter((e) => e.type === 'd').map((e) => e.name);
        const suggestion = await suggestRelativePath(sftp, prefix, folders);

        if (suggestion) {
            // The whole diagnosis collapses into one actionable sentence - the folder listing
            // would only be material for a deduction that has already been made here.
            parts.push(
                `This account starts at "${root}", where "${suggestion}" does exist, `
                + `so SFTP appears to be confined to a directory below the filesystem root. `
                + `Use "${suggestion}" as the path instead.`
            );
        } else {
            const names = folders.slice(0, ROOT_HINT_ENTRIES);
            // A truncated list reads as a complete one, and then a folder that is simply below
            // the cut-off looks like a folder that is not there - say how many were left out.
            const omitted = folders.length - names.length;
            const listed = omitted > 0 ? `${names.join(', ')} (and ${omitted} more)` : names.join(', ');
            parts.push(
                `This account starts at "${root}"`
                + (names.length ? ` and sees these folders there: ${listed}.` : ' and sees no folders there.')
            );
            parts.push(
                `If SFTP is confined to that directory, give the path relative to it instead of as an absolute filesystem path.`
            );
        }
    } catch { /* No cwd/list either - the leading sentence already says enough. */ }

    return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Creates a remote directory, never reaching above the adapter's configured path.
 *
 * ssh2-sftp-client's recursive mkdir walks *upwards* until it finds a directory that exists,
 * and it decides that by calling exists() - which reports false for a directory the account
 * may use but not stat. On a NAS that is the normal case: an account can write inside
 * /volume1/Transfer but cannot stat /volume1 itself, so the recursion climbed to the top and
 * tried to create /volume1, failing with "Permission denied /volume1" - a message pointing at
 * a path nobody asked for.
 *
 * The configured prefix is a precondition, not something to create: if it is missing, that is
 * reported as what it is. Only the segments below it are created, one at a time, so the walk
 * can never leave the area the account was given.
 */
async function ensureRemoteDir(
    sftp: Client,
    dir: string,
    pathPrefix: string | undefined,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    if (await sftp.exists(dir) === 'd') return;

    const prefix = pathPrefix ? pathPrefix.replace(/\\/g, '/') : '';
    if (!prefix) {
        // No configured root to anchor to - the whole path is ours to create.
        if (onLog) onLog(`Creating remote directory: ${dir}`, 'info', 'storage');
        await sftp.mkdir(dir, true);
        return;
    }

    if (await sftp.exists(prefix) !== 'd') {
        throw new Error(
            `The configured path "${prefix}" does not exist or is not reachable for this account over SFTP.`
            + await describeSftpRoot(sftp, prefix)
        );
    }

    const relative = path.posix.relative(prefix, dir);
    // Outside the prefix entirely - refuse rather than climb out of the configured area.
    if (relative.startsWith('..')) {
        throw new Error(`Refusing to create '${dir}': it lies outside the configured path "${prefix}".`);
    }

    let current = prefix;
    for (const segment of relative.split('/').filter(Boolean)) {
        current = path.posix.join(current, segment);
        if (await sftp.exists(current) !== 'd') {
            if (onLog) onLog(`Creating remote directory: ${current}`, 'info', 'storage');
            await mkdirIdempotent(sftp, current);
        }
    }
}

/** Performs a single download on an already-connected SFTP client. */
async function performSftpDownload(
    sftp: Client,
    config: SFTPConfig,
    remotePath: string,
    localPath: string,
    onProgress?: (processed: number, total: number) => void
): Promise<boolean> {
    try {
        const source = config.pathPrefix
            ? path.posix.join(config.pathPrefix, remotePath)
            : remotePath;

        // fastGet regardless of whether anyone watches progress: which transfer algorithm runs
        // must not depend on whether a caller passed a callback. Directory collection used to
        // pass none, and that alone put every file of a file backup on the slow
        // single-request path.
        //
        // The size comes from the transfer's own step callback rather than from a stat, so
        // watching progress costs nothing. It used to cost one extra round trip per file,
        // which is the wrong price to pay on the adapter where round trips are the bottleneck.
        //
        // fastGet still spends an FSTAT of its own to learn the size before reading. Passing its
        // `fileSize` option would skip that - one of four round trips per file. The caller knows
        // the size from the listing but does not pass it down yet. See PERF-SFTP-MULTIPLEX in
        // `openSession` below for the measurements and the larger win alongside it.
        await sftp.fastGet(source, localPath, {
            ...TRANSFER_TUNING,
            step: (transferred: number, _chunk: number, total: number) => onProgress?.(transferred, total),
        });
        return true;
    } catch (error) {
        log.error("SFTP download failed", { host: config.host, remotePath }, wrapError(error));
        return false;
    }
}

/**
 * Performs a single upload on an already-connected SFTP client. The directory
 * cache prevents redundant mkdir calls when reused across multiple uploads
 * (e.g. metadata sidecar + backup file in the same session).
 */
async function performSftpUpload(
    sftp: Client,
    config: SFTPConfig,
    localPath: string,
    remotePath: string,
    onProgress: ((percent: number) => void) | undefined,
    onLog: ((msg: string, level?: LogLevel, type?: LogType, details?: string) => void) | undefined,
    dirCache: Set<string>
): Promise<boolean> {
    try {
        const destination = config.pathPrefix
            ? path.posix.join(config.pathPrefix, remotePath)
            : remotePath;

        const remoteDir = path.posix.dirname(destination);
        if (!dirCache.has(remoteDir)) {
            await ensureRemoteDir(sftp, remoteDir, config.pathPrefix, onLog);
            dirCache.add(remoteDir);
        }

        if (onLog) onLog(`Starting SFTP upload to: ${destination}`, 'info', 'storage');

        // The transfer already knows the size and hands it to every step callback, so asking the
        // filesystem for it separately would only add a stat per file for a number we are given.
        await sftp.fastPut(localPath, destination, {
            ...TRANSFER_TUNING,
            step: (transferred: number, _chunk: number, total: number) => {
                if (onProgress && total > 0) onProgress(Math.round((transferred / total) * 100));
            },
        });

        if (onLog) onLog(`SFTP upload completed successfully`, 'info', 'storage');
        return true;
    } catch (error: unknown) {
        log.error("SFTP upload failed", { host: config.host, remotePath }, wrapError(error));
        if (onLog && error instanceof Error) onLog(`SFTP upload failed: ${error.message}`, 'error', 'storage', error.stack);
        return false;
    }
}

/**
 * The raw ssh2 SFTP channel behind an ssh2-sftp-client instance.
 *
 * Reached through the wrapper because two operations exist on the protocol but not on the
 * wrapper's API: `readlink` and `symlink`. The wrapper offers `realPath`, which is not a
 * substitute - it resolves a link the whole way to its final destination, which is exactly the
 * information a backup must not store. `../../archive/cert1.pem` resolved to an absolute path
 * is wrong from any other machine, and wrong again after the target rotates.
 */
type RawSftp = {
    readlink(path: string, cb: (err: Error | undefined, target: string) => void): void;
    symlink(target: string, path: string, cb: (err: Error | undefined) => void): void;
};

function rawSftp(client: Client): RawSftp | undefined {
    return (client as unknown as { sftp?: RawSftp }).sftp;
}

/**
 * Reads a symbolic link's target, leaving it exactly as the server stores it.
 *
 * Falls back to the `ls -l` style `longname` most servers put in a directory listing, since
 * that carries the target too. Returns undefined when neither works, which the caller reports
 * as a link it could not describe rather than passing off as absent.
 */
async function readSftpLinkTarget(client: Client, fullPath: string, longname?: string): Promise<string | undefined> {
    const raw = rawSftp(client);
    if (raw?.readlink) {
        const target = await new Promise<string | undefined>((resolve) => {
            try {
                raw.readlink(fullPath, (err, value) => resolve(err ? undefined : value));
            } catch {
                resolve(undefined);
            }
        });
        if (target) return target;
    }

    // "lrwxrwxrwx 1 user group 24 Jan  1 00:00 cert.pem -> ../archive/cert1.pem"
    const arrow = longname?.indexOf(" -> ");
    if (longname && arrow !== undefined && arrow !== -1) {
        const target = longname.slice(arrow + 4).trim();
        if (target.length > 0) return target;
    }
    return undefined;
}

/**
 * Walks a source tree for collection: skipping what is excluded, reporting as it goes, and
 * stopping when asked.
 *
 * Kept apart from `list()` rather than replacing it. `list()` also serves retention, integrity
 * checks and the browse UI, where the tree is a flat directory of backup files and none of
 * this applies - and where its depth-first order has been the behaviour all along. This walk
 * is breadth-first because that is what allows several directories to be read at once, which
 * is the entire point: SFTP spends one round trip per directory, so a tree of a few thousand
 * folders is minutes of pure waiting on a serial walk and seconds on a parallel one.
 *
 * Paths handed to the exclude predicate are relative to the queried directory, matching what
 * `toRelativePath()` derives on the caller's side. Getting that wrong would apply
 * `node_modules/**` at the wrong depth and either prune nothing or prune the wrong subtree.
 */
async function walkSftpTree(
    config: SFTPConfig,
    dir: string,
    options?: ListTreeOptions
): Promise<ListTreeResult> {
    const normalize = (p: string) => p.replace(/\\/g, '/');
    const prefix = config.pathPrefix ? normalize(config.pathPrefix) : "";
    const startDir = prefix ? path.posix.join(prefix, dir) : (dir || ".");
    const limit = Math.max(1, options?.concurrency ?? 1);

    const files: FileInfo[] = [];
    const pruned: PrunedDirectory[] = [];
    const unsupportedSymlinks: string[] = [];
    let directoriesRead = 0;

    let client: Client | null = null;

    try {
        options?.signal?.throwIfAborted();
        client = await connectSFTPForSource(config);
        const exists = await client.exists(startDir);
        if (exists !== 'd') return { files, pruned };

        /** Path relative to the adapter's configured root, the convention `list()` also uses. */
        const toAdapterPath = (fullPath: string): string => {
            let relativePath = fullPath;
            if (prefix && fullPath.startsWith(prefix)) relativePath = fullPath.substring(prefix.length);
            return relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
        };

        // One level at a time. Every directory of a level is read concurrently, and the
        // directories they reveal become the next level.
        let frontier: string[] = [""];

        while (frontier.length > 0) {
            const next = await mapWithConcurrency(frontier, limit, async (relDir): Promise<string[]> => {
                options?.signal?.throwIfAborted();

                const currentDir = relDir ? path.posix.join(startDir, relDir) : startDir;
                const items = await client!.list(currentDir);
                const children: string[] = [];

                for (const item of items) {
                    const childRel = relDir ? `${relDir}/${item.name}` : item.name;
                    // Same convention as list(): relative to the adapter's configured root,
                    // not to the queried directory - the caller strips the rest.
                    const fullPath = path.posix.join(currentDir, item.name);

                    if (item.type === 'd') {
                        const pattern = canPruneDirectory(childRel, options?.excludePatterns);
                        if (pattern) {
                            pruned.push({ path: childRel, pattern });
                            continue;
                        }
                        children.push(childRel);
                    } else if (item.type === 'l') {
                        // Stored as a link and not followed, whether it points at a file or a
                        // directory. Descending would copy the target's bytes under the link's
                        // path, which is a different tree than the one being backed up.
                        const target = await readSftpLinkTarget(
                            client!,
                            fullPath,
                            (item as { longname?: string }).longname
                        );
                        if (target === undefined) {
                            unsupportedSymlinks.push(childRel);
                            continue;
                        }
                        files.push({
                            name: item.name,
                            path: toAdapterPath(fullPath),
                            size: 0,
                            lastModified: new Date(item.modifyTime),
                            linkTarget: target,
                        });
                    } else if (item.type === '-') {
                        files.push({
                            name: item.name,
                            path: toAdapterPath(fullPath),
                            size: item.size,
                            lastModified: new Date(item.modifyTime),
                        });
                    }
                }

                // Counters are mutated between awaits, which Node never interleaves.
                directoriesRead++;
                options?.onProgress?.({
                    files: files.length,
                    directories: directoriesRead,
                    prunedDirectories: pruned.length,
                    currentPath: relDir,
                });

                return children;
            });

            frontier = next.flat();
        }

        return { files, pruned, ...(unsupportedSymlinks.length > 0 ? { unsupportedSymlinks } : {}) };
    } catch (error) {
        log.error("SFTP tree walk failed", { host: config.host, dir }, wrapError(error));
        throw error;
    } finally {
        if (client) await endSftpClient(client);
    }
}

export const SFTPAdapter: StorageAdapter = {
    id: "sftp",
    type: "storage",
    name: "SFTP (SSH)",
    configSchema: SFTPSchema,
    credentials: { primary: "SSH_KEY" },

    async openSession(config: SFTPConfig, onLog?, options?): Promise<StorageSession> {
        // PERF-SFTP-MULTIPLEX
        //
        // One connection per transfer in flight. This is the reason the concurrency ceiling is
        // 8 (see `transferConcurrency` for sftp in `src/lib/adapters/definitions/index.ts`), and
        // that ceiling is self-imposed rather than protocol-imposed: SFTP multiplexes by request
        // id - ssh2 tracks them in `this._requests[reqid]` - so a single connection can carry
        // any number of concurrent operations. `fastGet` already relies on this, issuing 64
        // parallel reads over one channel. N parallel *files* would need no extra login either.
        //
        // Why it matters: a small file costs four round trips (OPEN, FSTAT, READ, CLOSE), so a
        // source of many small files is bound by latency, not bandwidth. Measured over a ~40 ms
        // link, 766 files of ~23 KB took 88s at concurrency 4 and 45s at 8 - linear, with the
        // link nowhere near saturated. Multiplexing over one connection would lift the ceiling
        // entirely, up to what the server's own sftp-server process can chew through.
        //
        // Two cheaper wins live nearby, in `performSftpDownload`: `fastGet` accepts a
        // `fileSize` option and skips its FSTAT when given one, and the size is already known
        // from the listing - one of four round trips, for one argument.
        //
        // Not done here on purpose: it inverts the pooling model below and belongs in its own
        // change, measured on its own.
        //
        // Liveness is tracked by the connection telling us it dropped, rather than by inspecting
        // the client afterwards: the default has to be "usable", so that a future library change
        // cannot silently turn pooling off by making every connection look dead.
        // Liveness is tracked by the connection telling us it dropped, rather than by inspecting
        // the client afterwards: the default has to be "usable", so that a future library change
        // cannot silently turn pooling off by making every connection look dead.
        const pool = createConnectionPool<PooledClient>({
            limit: options?.concurrency ?? 1,
            connect: async () => {
                const entry: PooledClient = { client: null as unknown as Client, alive: true };
                entry.client = await connectSFTP(config, () => { entry.alive = false; });
                return entry;
            },
            disconnect: async (entry) => { await endSftpClient(entry.client); },
            isAlive: (entry) => entry.alive,
        });

        // Opened right away rather than on the first transfer, so bad credentials or an
        // unreachable host fail here - where the caller can report one clear error - instead of
        // separately for every file. The remaining connections are opened only if the transfers
        // actually run in parallel.
        try {
            await pool.withConnection(async () => undefined);
        } catch (error) {
            await pool.close();
            throw error;
        }

        // Announced once for the session rather than once per connection. How many sockets a
        // pool ends up opening is an implementation detail, and printing a line for each buried
        // the run's actual events under a wall of identical "Connected to" entries.
        if (onLog) {
            const limit = options?.concurrency ?? 1;
            onLog(
                `Connected to SFTP ${config.host}:${config.port}`
                + (limit > 1 ? ` (up to ${limit} parallel transfers)` : ''),
                'info',
                'storage'
            );
        }

        // Shared across the pool, not per connection: which directories exist is a property of
        // the server, so one file's mkdir spares every other file the same check.
        const dirCache = new Set<string>();

        return {
            upload: (localPath, remotePath, onProgress, uploadLog) =>
                pool.withConnection(({ client }) =>
                    performSftpUpload(client, config, localPath, remotePath, onProgress, uploadLog ?? onLog, dirCache)),
            download: (remotePath, localPath, onProgress) =>
                pool.withConnection(({ client }) => performSftpDownload(client, config, remotePath, localPath, onProgress)),
            close: () => pool.close(),
        };
    },

    async upload(config: SFTPConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);
            if (onLog) onLog(`Connected to SFTP ${config.host}:${config.port}`, 'info', 'storage');
            return await performSftpUpload(sftp, config, localPath, remotePath, onProgress, onLog, new Set());
        } catch (error: unknown) {
            log.error("SFTP upload failed", { host: config.host, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`SFTP upload failed: ${error.message}`, 'error', 'storage', error.stack);
            return false;
        } finally {
            if (sftp) await endSftpClient(sftp);
        }
    },

    async listTree(config: SFTPConfig, dir: string = "", options?: ListTreeOptions): Promise<ListTreeResult> {
        return walkSftpTree(config, dir, options);
    },

    async createSymlink(config: SFTPConfig, remotePath: string, target: string): Promise<void> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);
            const normalize = (p: string) => p.replace(/\\/g, '/');
            const prefix = config.pathPrefix ? normalize(config.pathPrefix) : "";
            const linkPath = prefix ? path.posix.join(prefix, remotePath) : remotePath;

            const parent = path.posix.dirname(linkPath);
            if (parent && parent !== '.' && parent !== '/') await sftp.mkdir(parent, true);

            const raw = rawSftp(sftp);
            if (!raw?.symlink) {
                throw new Error("this SFTP connection does not expose symlink support");
            }

            // Removed first, because SSH_FXP_SYMLINK fails on an existing path and a restore
            // that stops at the first already-present link is not a restore. `delete` removes
            // the link itself, never what it points at.
            await sftp.delete(linkPath, true).catch(() => { });

            await new Promise<void>((resolve, reject) => {
                // Argument order is (target, linkPath), the same way round as symlink(2) and
                // the opposite of what the name reads like. Swapping them creates a link named
                // after the target, which silently produces the wrong tree.
                raw.symlink(target, linkPath, (err) => (err ? reject(err) : resolve()));
            });
        } finally {
            if (sftp) await endSftpClient(sftp);
        }
    },

    async list(config: SFTPConfig, dir: string = ""): Promise<FileInfo[]> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);

            // Normalize path helper
            const normalize = (p: string) => p.replace(/\\/g, '/');

            // Determine where to start listing
            const prefix = config.pathPrefix ? normalize(config.pathPrefix) : "";
            const startDir = prefix
                ? path.posix.join(prefix, dir)
                : (dir || ".");

            const files: FileInfo[] = [];

            // Helper for recursive listing
            const walk = async (currentDir: string) => {
                const items = await sftp!.list(currentDir);

                for (const item of items) {
                    const fullPath = path.posix.join(currentDir, item.name);

                    if (item.type === 'd') {
                        await walk(fullPath);
                    } else if (item.type === '-') {
                        // Calculate UI-friendly relative path
                        // e.g. /home/user/backups/Job1/file.sql -> Job1/file.sql (if prefix is /home/user/backups)
                        let relativePath = fullPath;

                        // Strip the prefix part to make it relative to the "root" of the adapter
                        if (prefix && fullPath.startsWith(prefix)) {
                            relativePath = fullPath.substring(prefix.length);
                        }

                        // Remove leading slash
                        if (relativePath.startsWith('/')) relativePath = relativePath.substring(1);

                        files.push({
                            name: item.name,
                            path: relativePath,
                            size: item.size,
                            lastModified: new Date(item.modifyTime),
                        });
                    }
                }
            };

            // Start walking if directory exists
            const type = await sftp.exists(startDir);
            if (type === 'd') {
                await walk(startDir);
            }

            return files;

        } catch (error) {
            log.error("SFTP list failed", { host: config.host, dir }, wrapError(error));
            throw error;
        } finally {
            if (sftp) await endSftpClient(sftp);
        }
    },

    async browseDirectories(config: SFTPConfig, subPath: string = ""): Promise<DirectoryBrowseEntry[]> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);
            const startDir = config.pathPrefix
                ? path.posix.join(config.pathPrefix, subPath)
                : (subPath || ".");

            const type = await sftp.exists(startDir);
            if (type !== 'd') return [];

            const items = await sftp.list(startDir);
            return items
                .filter((item) => item.type === 'd')
                .map((item) => ({
                    name: item.name,
                    path: subPath ? `${subPath}/${item.name}` : item.name,
                }));
        } catch (error) {
            log.error("SFTP browseDirectories failed", { host: config.host, subPath }, wrapError(error));
            throw error;
        } finally {
            if (sftp) await endSftpClient(sftp);
        }
    },

    async downloadRange(config: SFTPConfig, remotePath: string, start: number, end: number): Promise<NodeJS.ReadableStream> {
        // An empty range is legal - a zero-length file's archive entry produces one.
        if (end < start) return Readable.from([]);

        const sftp = await connectSFTP(config);
        const source = config.pathPrefix ? path.posix.join(config.pathPrefix, remotePath) : remotePath;

        try {
            // createReadStream's `end` is inclusive, matching the capability's contract.
            const stream = sftp.createReadStream(source, { start, end }) as NodeJS.ReadableStream;
            // The connection has to outlive the stream, so it is closed on completion
            // rather than in a finally block here.
            const close = () => { void endSftpClient(sftp); };
            stream.on("end", close);
            stream.on("error", close);
            stream.on("close", close);
            return stream;
        } catch (error) {
            await endSftpClient(sftp);
            log.error("SFTP ranged download failed", { host: config.host, remotePath, start, end }, wrapError(error));
            throw error;
        }
    },

    async download(config: SFTPConfig, remotePath: string, localPath: string, onProgress?: (processed: number, total: number) => void): Promise<boolean> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);
            return await performSftpDownload(sftp, config, remotePath, localPath, onProgress);
        } catch (error) {
            log.error("SFTP download failed", { host: config.host, remotePath }, wrapError(error));
            return false;
        } finally {
            if (sftp) await endSftpClient(sftp);
        }
    },

    async read(config: SFTPConfig, remotePath: string): Promise<string | null> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);

            const source = config.pathPrefix
                ? path.posix.join(config.pathPrefix, remotePath)
                : remotePath;

            // get returns Buffer or string depending on options/destination
            // passing undefined as dst makes it return a buffer
            const buffer = await sftp.get(source);
            if (buffer instanceof Buffer) {
                return buffer.toString('utf-8');
            }
            return null;
        } catch (_error) {
            // Quietly fail if file not found (expected for missing .meta.json)
            return null;
        } finally {
            if (sftp) await endSftpClient(sftp);
        }
    },

    async delete(config: SFTPConfig, remotePath: string): Promise<boolean> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);

            const source = config.pathPrefix
                ? path.posix.join(config.pathPrefix, remotePath)
                : remotePath;

            await sftp.delete(source);
            return true;
        } catch (error) {
            log.error("SFTP delete failed", { host: config.host, remotePath }, wrapError(error));
            return false;
        } finally {
            if (sftp) await endSftpClient(sftp);
        }
    },

    async ping(config: SFTPConfig): Promise<{ success: boolean; message: string }> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);
            const checkPath = config.pathPrefix || '.';
            await sftp.stat(checkPath);
            return { success: true, message: "Connection successful" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `SFTP Connection failed: ${message}` };
        } finally {
            if (sftp) await endSftpClient(sftp);
        }
    },

    async test(config: SFTPConfig): Promise<{ success: boolean; message: string }> {
        let sftp: Client | null = null;
        const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
        const testFileName = `.dbackup/test/connection-test-sftp-${ts}`;
        const destination = config.pathPrefix
            ? path.posix.join(config.pathPrefix, testFileName)
            : testFileName;
        const subdir = config.pathPrefix
            ? path.posix.join(config.pathPrefix, '.dbackup/test')
            : '.dbackup/test';
        let remoteFileCreated = false;
        try {
            sftp = await connectSFTP(config);

            await ensureRemoteDir(sftp, subdir, config.pathPrefix);

            // 1. Write Test
            await sftp.put(Buffer.from("Connection Test"), destination);
            remoteFileCreated = true;

            // 2. Delete Test
            await sftp.delete(destination);
            remoteFileCreated = false;

            return { success: true, message: "Connection successful (Write/Delete verified)" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `SFTP Connection failed: ${message}` };
        } finally {
            if (remoteFileCreated) await sftp?.delete(destination).catch(() => {});
            if (sftp) await endSftpClient(sftp);
        }
    }

};
