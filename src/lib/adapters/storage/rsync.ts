import { StorageAdapter, StorageSession, FileInfo, DirectoryDownloadOptions, DirectoryDownloadResult, DirectoryFileEntry, DirectoryBrowseEntry, ListTreeResult } from "@/lib/core/interfaces";
import { RsyncSchema, type SFTPConfig } from "@/lib/adapters/definitions";
import { connectSFTP, endSftpClient } from "./sftp";
import { Readable } from "stream";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { toRelativePath } from "./common/download-directory";
import { matchesAnyExcludePattern } from "@/lib/exclude-patterns";
import { formatExcludeSummary, summariseExcluded } from "@/lib/exclude-summary";
import { runRsync, sanitizeCommand, type RsyncCommand } from "./rsync-process";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const log = logger.child({ adapter: "rsync" });

interface RsyncConfig {
    host: string;
    port: number;
    username: string;
    authType: "password" | "privateKey" | "agent";
    password?: string;
    privateKey?: string;
    passphrase?: string;
    pathPrefix: string;
    options?: string;
}

/**
 * Strips sensitive data and raw commands from error messages before returning to the user.
 * Removes the "Command failed: <cmd>" prefix that Node's execAsync includes.
 */
function sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    // Node's exec includes "Command failed: <full command>\n<stderr>" - strip the command part
    const stripped = message.replace(/Command failed:[^\n]*\n?/g, "").trim();
    // Remove SSH/sshpass warnings that leak connection details
    const cleaned = stripped
        .replace(/\*\*\s*WARNING:[^*]*\*\*/g, "")
        .replace(/See\s+https?:\/\/\S+/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    return sanitizeCommand(cleaned || message);
}

/**
 * Writes a temporary private key file for SSH authentication.
 * Returns the path to the temp file. Caller must delete it after use.
 */
async function writeTempKey(privateKey: string): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `rsync-key-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.writeFile(tmpFile, privateKey, { mode: 0o600 });
    return tmpFile;
}

/**
 * Writes the relative paths a directory download transfers to a temporary file for
 * `--files-from`, each ended by a NUL for `--from0`, since a file name may hold a newline.
 * Returns the path to the temp file. Caller must delete it after use.
 */
async function writeFileList(relativePaths: string[]): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `rsync-files-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.writeFile(tmpFile, relativePaths.map((relativePath) => `${relativePath}\0`).join(""), { mode: 0o600 });
    return tmpFile;
}

/**
 * Builds the SSH command string for rsync's -e flag (never contains passwords).
 */
function buildSshCommand(config: RsyncConfig, keyFile?: string, controlPath?: string): string {
    const parts = ["ssh", `-p ${config.port}`, "-o StrictHostKeyChecking=no"];

    // Every rsync invocation is its own SSH login. Multiplexing over one shared connection turns
    // a 129-file restore from 129 logins into one - see openSession() for why that matters.
    if (controlPath) {
        parts.push("-o ControlMaster=auto", `-o ControlPath=${controlPath}`, "-o ControlPersist=60");
    }

    if (config.authType === "password") {
        // Force password-only auth: disable pubkey to prevent SSH agent from
        // offering too many keys (causes "Too many authentication failures")
        parts.push("-o PreferredAuthentications=password");
        parts.push("-o PubkeyAuthentication=no");
    } else {
        // BatchMode only for key/agent auth (no interactive prompts)
        parts.push("-o BatchMode=yes");
    }

    if (config.authType === "privateKey" && keyFile) {
        // IdentitiesOnly forces ssh to use only this key, not every key offered by
        // a running ssh-agent - without it, an agent with several keys loaded can
        // exhaust the server's MaxAuthTries before this key is ever tried, causing
        // "Too many authentication failures".
        parts.push(`-i ${keyFile}`, "-o IdentitiesOnly=yes");
    }

    return parts.join(" ");
}

/**
 * Builds SSH arguments as an array for execFile (no shell interpretation).
 * This is the safe equivalent of buildSshCommand for non-shell execution.
 */
function buildSshArgArray(config: RsyncConfig, keyFile?: string, controlPath?: string): string[] {
    const args = ["-p", String(config.port), "-o", "StrictHostKeyChecking=no"];

    // See buildSshCommand() - the remote `mkdir` shares the session's connection too.
    if (controlPath) {
        args.push("-o", "ControlMaster=auto", "-o", `ControlPath=${controlPath}`, "-o", "ControlPersist=60");
    }

    if (config.authType === "password") {
        args.push("-o", "PreferredAuthentications=password");
        args.push("-o", "PubkeyAuthentication=no");
    } else {
        args.push("-o", "BatchMode=yes");
    }

    if (config.authType === "privateKey" && keyFile) {
        // See buildSshCommand() above for why IdentitiesOnly is required here.
        args.push("-i", keyFile, "-o", "IdentitiesOnly=yes");
    }

    return args;
}

/**
 * Escapes a value for safe inclusion in a single-quoted shell string on the remote host.
 * Handles the case where the value itself contains single quotes.
 */
function shellEscapeSingleQuote(value: string): string {
    return value.replace(/'/g, "'\\''" );
}

/**
 * Builds the remote path for rsync (user@host:path).
 */
function buildRemotePath(config: RsyncConfig, relativePath: string): string {
    const fullPath = path.posix.join(config.pathPrefix, relativePath);
    return `${config.username}@${config.host}:${fullPath}`;
}

/**
 * Returns environment variables for password auth via sshpass.
 * Uses SSHPASS env var instead of command line argument to avoid password leaking in process list.
 */
function getPasswordEnv(config: RsyncConfig): NodeJS.ProcessEnv | undefined {
    if (config.authType === "password" && config.password) {
        return { ...process.env, SSHPASS: config.password };
    }
    return undefined;
}

/**
 * Whether the local rsync understands `--info=progress2`.
 *
 * The flag reports one aggregate percentage for a whole directory transfer instead of one per
 * file, which is what the collection progress bar wants - but it arrived in rsync 3.1. Two
 * common installations are older: rsync 2.6.9, still shipped by some distributions, and
 * openrsync, which Apple made the default `rsync` in macOS 15 and which reports itself as "2.6.9
 * compatible". Both refuse the flag outright and abort the transfer, so it has to be asked for
 * rather than assumed.
 *
 * Probed once and cached for the process lifetime, like the sshpass check below.
 */
let _infoFlagSupported: boolean | null = null;
async function supportsInfoProgress(): Promise<boolean> {
    if (_infoFlagSupported !== null) return _infoFlagSupported;
    try {
        const { stdout } = await execAsync("rsync --version", { timeout: 5000 });
        // openrsync claims 2.6.9 compatibility in the same output, so it has to be ruled out by
        // name before the version number is read.
        const version = /openrsync/i.test(stdout) ? null : stdout.match(/version\s+(\d+)\.(\d+)/);
        _infoFlagSupported = version
            ? Number(version[1]) > 3 || (Number(version[1]) === 3 && Number(version[2]) >= 1)
            : false;
    } catch {
        // No usable version output - assume the older behaviour, which every rsync accepts.
        _infoFlagSupported = false;
    }
    return _infoFlagSupported;
}

/**
 * Checks if sshpass is available on the system.
 * Called once and cached for the process lifetime.
 */
let _sshpassAvailable: boolean | null = null;
async function checkSshpass(): Promise<boolean> {
    if (_sshpassAvailable !== null) return _sshpassAvailable;
    try {
        await execAsync("which sshpass", { timeout: 5000 });
        _sshpassAvailable = true;
    } catch {
        _sshpassAvailable = false;
    }
    return _sshpassAvailable;
}

/** How long an SSH command may take and how much it may print, when the default does not fit. */
interface SshExecOptions {
    timeout?: number;
    maxBuffer?: number;
}

const SSH_TIMEOUT_MS = 30_000;

/**
 * The limits of a `find` over a whole tree. Node keeps the output of execFile in memory and
 * stops at 1 MB by default, which a tree of some 15,000 files already prints (#168), and a BSD
 * `find` that runs `stat` once per file takes longer than the 30 seconds of a short command.
 * Bounded all the same, so a runaway listing ends with a message instead of filling the memory.
 */
const LISTING_LIMITS: Required<SshExecOptions> = { timeout: 10 * 60_000, maxBuffer: 256 * 1024 * 1024 };

/**
 * Executes an SSH command on the remote host.
 * Uses execFile (no shell) to prevent command injection via config values.
 * Uses SSHPASS env var for password auth (never passes password on command line).
 */
async function execSSH(config: RsyncConfig, command: string, keyFile?: string, controlPath?: string, options: SshExecOptions = {}): Promise<string> {
    const sshArgs = buildSshArgArray(config, keyFile, controlPath);
    const target = `${config.username}@${config.host}`;
    const env = getPasswordEnv(config) ?? process.env;

    let binary: string;
    let args: string[];

    if (config.authType === "password" && config.password) {
        if (!await checkSshpass()) {
            throw new Error("Password authentication requires 'sshpass' to be installed. Install it or use SSH key / agent authentication instead.");
        }
        // sshpass -e ssh [ssh-args] user@host command
        binary = "sshpass";
        args = ["-e", "ssh", ...sshArgs, target, command];
    } else {
        binary = "ssh";
        args = [...sshArgs, target, command];
    }

    const timeout = options.timeout ?? SSH_TIMEOUT_MS;
    try {
        const { stdout } = await execFileAsync(binary, args, { timeout, env, ...(options.maxBuffer ? { maxBuffer: options.maxBuffer } : {}) });
        return stdout.trim();
    } catch (error: unknown) {
        const failure = error as { code?: unknown; killed?: boolean };
        if (failure?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            const limit = Math.round((options.maxBuffer ?? 1024 * 1024) / (1024 * 1024));
            throw new Error(`The server answered with more than ${limit} MB. Back up its subfolders as separate sources.`);
        }
        if (failure?.killed) throw new Error(`The server did not finish within ${Math.round(timeout / 1000)} seconds.`);
        // Re-throw with sanitized message (strips raw command from exec errors)
        throw new Error(sanitizeError(error));
    }
}

/**
 * Shuts down a multiplexed SSH master connection.
 *
 * `ssh -O exit` is the only way to end it: deleting the socket file just orphans the master,
 * which then keeps an authenticated connection open until ControlPersist runs out. No password
 * is needed - the request travels over the existing socket rather than opening a new session.
 */
async function closeSshMaster(config: RsyncConfig, keyFile: string | undefined, controlPath: string): Promise<void> {
    const args = [...buildSshArgArray(config, keyFile, controlPath), "-O", "exit", `${config.username}@${config.host}`];
    await execFileAsync("ssh", args, { timeout: 10000 }).catch(() => { });
}

/**
 * Lists a remote tree over SSH with `find`, optionally including symbolic links.
 *
 * Two dialects, because the GNU `-printf` this relies on does not exist on BSD `find` (macOS,
 * FreeBSD). The fallback shells out to `stat` per entry and has no way to report a link
 * target, so it stays files-only and says so through `unsupportedSymlinks` rather than
 * quietly returning a shorter list.
 *
 * `%y` is the entry type (`f` or `l`), `%l` the link target, empty for anything else. `find`
 * without `-L` does not follow links, so a link to a directory is reported as a link and not
 * descended into - which is the behaviour a backup wants and the same one `rsync -a` has.
 */
async function findRemoteEntries(
    config: RsyncConfig,
    dir: string,
    includeSymlinks: boolean
): Promise<{ files: FileInfo[]; unsupportedSymlinks: string[] }> {
    let keyFile: string | undefined;
    try {
        if (config.authType === "privateKey" && config.privateKey) {
            keyFile = await writeTempKey(config.privateKey);
        }

        const normalize = (p: string) => p.replace(/\\/g, "/");
        const prefix = config.pathPrefix ? normalize(config.pathPrefix) : "";
        const startDir = prefix
            ? path.posix.join(prefix, dir)
            : (dir || "/");

        const safeStartDir = shellEscapeSingleQuote(startDir);
        const selector = includeSymlinks ? `\\( -type f -o -type l \\)` : `-type f`;
        const output = await execSSH(
            config,
            `find '${safeStartDir}' ${selector} -printf '%p\\t%s\\t%T@\\t%y\\t%l\\n' 2>/dev/null || find '${safeStartDir}' -type f -exec stat -f '%N\\t%z\\t%m' {} \\; 2>/dev/null`,
            keyFile,
            undefined,
            LISTING_LIMITS
        );

        if (!output) return { files: [], unsupportedSymlinks: [] };

        const files: FileInfo[] = [];
        // A GNU run always emits the type column. Its absence means the BSD fallback ran, so
        // links were never selected in the first place and the caller has to be told.
        let sawTypeColumn = false;

        for (const line of output.split("\n")) {
            if (!line.trim()) continue;

            const parts = line.split("\t");
            if (parts.length < 3) continue;

            const [filePath, sizeStr, modifiedStr, type, linkTarget] = parts;
            const size = parseInt(sizeStr, 10) || 0;
            const modified = parseFloat(modifiedStr) || 0;
            if (type) sawTypeColumn = true;

            // Calculate relative path (strip prefix)
            let relativePath = normalize(filePath);
            if (prefix && relativePath.startsWith(prefix)) {
                relativePath = relativePath.substring(prefix.length);
            }
            if (relativePath.startsWith("/")) relativePath = relativePath.substring(1);

            const isLink = type === "l";
            if (isLink && !linkTarget) continue;

            files.push({
                name: path.basename(filePath),
                path: relativePath,
                // A link's own size is the byte length of its target string, which says
                // nothing about the backup and would inflate every total it lands in.
                size: isLink ? 0 : size,
                lastModified: new Date(modified * 1000),
                ...(isLink ? { linkTarget } : {}),
            });
        }

        const unsupportedSymlinks = includeSymlinks && !sawTypeColumn && files.length > 0
            ? ["<remote find does not support -printf, symbolic links were not collected>"]
            : [];

        return { files, unsupportedSymlinks };
    } catch (error: unknown) {
        log.error("Rsync list failed", { host: config.host, dir }, wrapError(error));
        throw error;
    } finally {
        if (keyFile) await fs.unlink(keyFile).catch(() => { });
    }
}

/**
 * The options every rsync of a connection runs with: archive mode, the SSH command of the
 * connection and its additional options. For password auth, sshpass reads the password from
 * the SSHPASS variable of the environment, never from the command line.
 * Must be called after checkSshpass() for password auth, which it does itself.
 */
async function buildRsyncArgs(config: RsyncConfig, keyFile?: string, controlPath?: string): Promise<RsyncCommand> {
    // Archive mode, but deliberately without `-z`. Compressing in transit costs CPU on both ends
    // and changes nothing about what gets stored: DBackup compresses each archive entry itself in
    // the packing stage afterwards, so `-z` is the same work done twice. It also only pays off at
    // all on data that compresses, and a backup source is mostly the opposite - archives, images,
    // video, installers. On a slow link with genuinely compressible data it can still be worth it,
    // which is what the connection's "Additional rsync options" field is for.
    const args = ["-a", "--partial", "--progress"];

    // rsync splits the -e command into its words itself, the same as it always did.
    const sshCmd = buildSshCommand(config, keyFile, controlPath);
    let env: NodeJS.ProcessEnv | undefined;
    if (config.authType === "password" && config.password) {
        if (!await checkSshpass()) {
            throw new Error("Password authentication requires 'sshpass' to be installed. Install it or use SSH key / agent authentication instead.");
        }
        args.push("-e", `sshpass -e ${sshCmd}`);
        env = getPasswordEnv(config);
    } else {
        args.push("-e", sshCmd);
    }

    // The additional options go to rsync as they were written. Taking them apart turned a
    // combined `-avz` into the option `--avz`, which rsync refuses.
    if (config.options) args.push(...config.options.split(/\s+/).filter(Boolean));

    return { args, ...(env ? { env } : {}) };
}

/**
 * Performs a single rsync upload using a pre-written key file. The mkdir cache
 * prevents redundant remote `mkdir -p` SSH calls when reused across multiple
 * uploads in the same session (e.g. metadata sidecar + backup file in the
 * same target directory).
 *
 * Note: each rsync invocation still opens its own SSH connection internally;
 * the savings here are the extra `execSSH` mkdir call and the temporary key
 * file write per additional upload.
 */
async function performRsyncUpload(
    config: RsyncConfig,
    keyFile: string | undefined,
    localPath: string,
    remotePath: string,
    onProgress: ((percent: number) => void) | undefined,
    onLog: ((msg: string, level?: LogLevel, type?: LogType, details?: string) => void) | undefined,
    dirCache: Set<string>,
    controlPath?: string
): Promise<boolean> {
    try {
        const destination = buildRemotePath(config, remotePath);
        const remoteDir = path.posix.dirname(path.posix.join(config.pathPrefix, remotePath));

        if (!dirCache.has(remoteDir)) {
            if (onLog) onLog(`Ensuring remote directory: ${remoteDir}`, "info", "storage");
            try {
                await execSSH(config, `mkdir -p '${shellEscapeSingleQuote(remoteDir)}'`, keyFile, controlPath);
            } catch (e) {
                log.warn("Could not create remote directory via SSH, rsync may handle it", {}, wrapError(e));
            }
            dirCache.add(remoteDir);
        }

        if (onLog) onLog(`Starting rsync upload to: ${config.host}:${remotePath}`, "info", "storage");

        const command = await buildRsyncArgs(config, keyFile, controlPath);

        let lastPercent = 0;
        await runRsync(command, { source: localPath, destination }, (msg, level, type, details) => {
            const progressMatch = msg.match(/(\d+)%/);
            if (progressMatch && onProgress) {
                const percent = parseInt(progressMatch[1], 10);
                if (percent > lastPercent) {
                    lastPercent = percent;
                    onProgress(percent);
                }
            }
            if (onLog) onLog(msg, level, type, details);
        });

        if (onProgress) onProgress(100);
        if (onLog) onLog("Rsync upload completed successfully", "info", "storage");
        return true;
    } catch (error: unknown) {
        log.error("Rsync upload failed", { host: config.host, remotePath }, wrapError(error));
        if (onLog) onLog(`Rsync upload failed: ${sanitizeError(error)}`, "error", "storage");
        return false;
    }
}

export const RsyncAdapter: StorageAdapter = {
    id: "rsync",
    type: "storage",
    name: "Rsync (SSH)",
    configSchema: RsyncSchema,
    credentials: { primary: "SSH_KEY" },

    async openSession(config: RsyncConfig, onLog?): Promise<StorageSession> {
        let keyFile: string | undefined;
        if (config.authType === "privateKey" && config.privateKey) {
            keyFile = await writeTempKey(config.privateKey);
        }

        // rsync has no persistent connection of its own: every file is a separate process that
        // logs in over SSH again, and the remote mkdir is another login on top. A 129-file
        // restore therefore made well over 129 logins in under a minute, which is slow and is
        // what an SSH server's connection-rate limiting is meant to stop - OpenSSH's MaxStartups
        // drops a share of them at random, and rsync reports that as a bare exit code 255.
        //
        // OpenSSH's own answer is connection multiplexing: the first login leaves a control
        // socket behind and every later one rides through it instead of authenticating again.
        // That is the same thing the pooled adapters do, expressed the way rsync can use it.
        const controlPath = path.join(os.tmpdir(), `dbackup-rsync-${Math.random().toString(36).slice(2, 10)}`);

        // Established once here rather than by whichever transfer happens to run first: several
        // starting at the same moment would each find no socket and open a master of their own,
        // which is the situation this exists to avoid. It also surfaces bad credentials as one
        // clear failure instead of one per file.
        try {
            await execSSH(config, "true", keyFile, controlPath);
            if (onLog) onLog(`Connected to ${config.host}:${config.port} (shared SSH connection)`, "info", "storage");
        } catch (error) {
            // Multiplexing is an optimisation, not a requirement: a server that refuses it (or a
            // socket path the platform rejects) must still be able to run the transfers, one
            // login at a time, exactly as before.
            log.warn("Could not establish a shared SSH connection, falling back to one per transfer", { host: config.host }, wrapError(error));
            if (keyFile) {
                return {
                    upload: (localPath, remotePath, onProgress, uploadLog) =>
                        performRsyncUpload(config, keyFile, localPath, remotePath, onProgress, uploadLog ?? onLog, new Set()),
                    close: async () => { await fs.unlink(keyFile!).catch(() => { }); },
                };
            }
            return {
                upload: (localPath, remotePath, onProgress, uploadLog) =>
                    performRsyncUpload(config, undefined, localPath, remotePath, onProgress, uploadLog ?? onLog, new Set()),
                close: async () => { },
            };
        }

        const dirCache = new Set<string>();
        return {
            upload: (localPath, remotePath, onProgress, uploadLog) =>
                performRsyncUpload(config, keyFile, localPath, remotePath, onProgress, uploadLog ?? onLog, dirCache, controlPath),
            close: async () => {
                // Tell the master to exit rather than waiting out ControlPersist, so the run does
                // not leave an authenticated connection open behind it.
                await closeSshMaster(config, keyFile, controlPath);
                await fs.unlink(controlPath).catch(() => { });
                if (keyFile) await fs.unlink(keyFile).catch(() => { });
            },
        };
    },

    async upload(config: RsyncConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let keyFile: string | undefined;
        try {
            if (config.authType === "privateKey" && config.privateKey) {
                keyFile = await writeTempKey(config.privateKey);
            }
            return await performRsyncUpload(config, keyFile, localPath, remotePath, onProgress, onLog, new Set());
        } finally {
            if (keyFile) await fs.unlink(keyFile).catch(() => { });
        }
    },

    async download(config: RsyncConfig, remotePath: string, localPath: string, onProgress?: (processed: number, total: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let keyFile: string | undefined;
        try {
            if (config.authType === "privateKey" && config.privateKey) {
                keyFile = await writeTempKey(config.privateKey);
            }

            if (onLog) onLog(`Starting rsync download from: ${config.host}:${remotePath}`, "info", "storage");

            // Ensure local directory exists
            const localDir = path.dirname(localPath);
            await fs.mkdir(localDir, { recursive: true });

            const command = await buildRsyncArgs(config, keyFile);
            const source = buildRemotePath(config, remotePath);

            await runRsync(command, { source, destination: localPath }, (msg, level, type, details) => {
                // Parse transferred bytes from rsync output
                const bytesMatch = msg.match(/^\s*([\d,]+)\s+\d+%/);
                if (bytesMatch && onProgress) {
                    const bytes = parseInt(bytesMatch[1].replace(/,/g, ""), 10);
                    onProgress(bytes, bytes);
                }
                if (onLog) onLog(msg, level, type, details);
            });

            return true;
        } catch (error: unknown) {
            log.error("Rsync download failed", { host: config.host, remotePath }, wrapError(error));
            if (onLog) onLog(`Rsync download failed: ${sanitizeError(error)}`, "error", "storage");
            return false;
        } finally {
            if (keyFile) await fs.unlink(keyFile).catch(() => {});
        }
    },

    /**
     * Native directory download: unlike upload/download (single file each), this syncs an
     * entire remote directory tree in one native `rsync -a` transfer, preserving rsync's
     * delta-transfer advantage (kept for directory-source (JobSource) backups). The file
     * index (for the manifest's Tier-A searchable listing) comes from the existing recursive
     * listing (a fast SSH `find`), filtered by the exclude patterns like every other adapter,
     * and the transfer takes exactly that list, so excluded files are never transferred at all.
     *
     * An incremental run narrows that same list to the files the chain does not already hold,
     * so the whole source is listed but only the changed part is transferred.
     *
     * A cancel ends the transfer: rsync cannot be asked to stop, so the process is killed.
     * Before that, a cancel only took effect between two sources, which on a single large
     * source meant waiting out the whole thing.
     */
    async downloadDirectory(
        config: RsyncConfig,
        remotePath: string,
        localPath: string,
        excludePatterns?: string[],
        onProgress?: (processedBytes: number, totalBytes: number, processedFiles: number, totalFiles: number) => void,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
        options?: DirectoryDownloadOptions
    ): Promise<DirectoryDownloadResult> {
        let keyFile: string | undefined;
        let listFile: string | undefined;
        try {
            // Checked before the listing, so a run cancelled while an earlier source was still
            // finishing never opens an SSH session for this one.
            options?.signal?.throwIfAborted();

            if (config.authType === "privateKey" && config.privateKey) {
                keyFile = await writeTempKey(config.privateKey);
            }

            if (onLog) onLog(`Listing remote directory: ${config.host}:${remotePath}`, "info", "storage");

            // listTree(), not list(): the collection needs symbolic links, and rsync's own
            // `-a` already brings them across into localPath. Listing them here is what puts
            // them into the archive index too, instead of leaving them on disk to be swept up
            // with the work directory.
            const { files: allFiles, unsupportedSymlinks } = await RsyncAdapter.listTree!(config, remotePath);
            if (unsupportedSymlinks?.length && onLog) {
                onLog(
                    `Symbolic links under ${remotePath} could not be collected: the remote 'find' does not support -printf. They are missing from this backup.`,
                    "warning", "storage"
                );
            }

            const listed: DirectoryFileEntry[] = allFiles.map((f) => ({
                relativePath: toRelativePath(f.path, remotePath),
                size: f.size,
                lastModified: f.lastModified,
                ...(f.linkTarget !== undefined ? { linkTarget: f.linkTarget } : {}),
            }));
            const entries = listed.filter((e) => !matchesAnyExcludePattern(e.relativePath, excludePatterns));

            // Excluding files silently is the one thing a backup must not do. Reported per pattern
            // rather than per file, like the other adapters, so a node_modules does not write tens
            // of thousands of paths into the execution log on every run.
            if (entries.length < listed.length && onLog) {
                const kept = new Set(entries.map((e) => e.relativePath));
                const excluded = listed.filter((e) => !kept.has(e.relativePath)).map((e) => ({ path: e.relativePath, size: e.size }));
                const { message, details } = formatExcludeSummary(summariseExcluded(excluded, excludePatterns ?? [], []));
                onLog(message, "info", "storage", details);
            }

            // Incremental runs hand down a predicate that answers, per file, whether the chain
            // already holds it. Honoured by narrowing the --files-from list rather than by
            // handing the source to the generic per-file collector: that one calls download()
            // once per file, which here means one rsync process and one SSH login each, so a
            // source of many small files would come out slower than transferring all of them
            // in a single native sync. The destination tree is new on every run, so rsync's
            // own quick check has nothing to compare against and cannot make this decision.
            //
            // A link is never asked about, the same order the generic collector keeps: there
            // are no bytes to skip, and answering "unchanged" would mark it for carry-forward,
            // which links deliberately do not take part in - it would drop out of the snapshot.
            const toTransfer: DirectoryFileEntry[] = [];
            const resultEntries: DirectoryFileEntry[] = [];
            for (const entry of entries) {
                if (entry.linkTarget === undefined && options?.shouldDownload && !options.shouldDownload(entry)) {
                    resultEntries.push({ ...entry, unchanged: true });
                    continue;
                }
                toTransfer.push(entry);
                resultEntries.push(entry);
            }

            const totalFiles = entries.length;
            const transferFiles = toTransfer.length;
            const unchangedFiles = totalFiles - transferFiles;
            // Only what moves counts, which is the same split the generic collector reports:
            // an unchanged file lands in the file count at zero bytes.
            const totalBytes = toTransfer.reduce((sum, e) => sum + e.size, 0);

            if (totalFiles === 0) {
                if (onLog) onLog(`No files found under ${remotePath}`, "info", "storage");
                return { files: 0, bytes: 0, entries: [], failures: [] };
            }

            if (unchangedFiles > 0 && onLog) {
                onLog(`${unchangedFiles} of ${totalFiles} file(s) unchanged, not transferred`, "info", "storage");
            }

            // The chain already holds every file of this source. rsync reads an empty
            // --files-from without complaining, but a transfer that copies nothing still
            // costs an SSH login, so it is skipped outright.
            if (transferFiles === 0) {
                if (onProgress) onProgress(0, 0, totalFiles, totalFiles);
                return { files: totalFiles, bytes: 0, entries: resultEntries, failures: [] };
            }

            await fs.mkdir(localPath, { recursive: true });

            if (onLog) onLog(`Starting rsync directory download from: ${config.host}:${remotePath} (${transferFiles} file(s))`, "info", "storage");

            const command = await buildRsyncArgs(config, keyFile);
            // Without it the transfer still reports progress, just per file rather than as one
            // figure for the whole directory - `--progress` is set either way.
            const extra = (await supportsInfoProgress()) ? ["--info=progress2"] : [];

            // The transfer takes exactly the files of the index. rsync's own --exclude reads the
            // same patterns by other rules: an unanchored pattern with a slash matches at any
            // depth, and a slash-free one also matches a folder and drops it whole. The index
            // then named files that never arrived, and hashing them failed the run. With
            // --files-from, -a copies links as links and does not recurse, and rsync 2.6.9,
            // rsync 3 and Apple's openrsync all read the list, NUL-separated with --from0.
            listFile = await writeFileList(toTransfer.map((e) => e.relativePath));
            extra.push(`--files-from=${listFile}`, "--from0");

            // Trailing slash: sync the directory's CONTENTS into localPath, not the directory itself
            const source = `${buildRemotePath(config, remotePath)}/`;

            await runRsync(command, { source, destination: localPath, extra }, (msg, level, type, details) => {
                // Progress lines come in two dialects, and the remaining-files counter is spelled
                // differently in each: `to-chk` from rsync 3's --info=progress2, `to-check` from
                // the 2.6.9 format that openrsync also speaks.
                //   " 1,234,567  45%  12.34MB/s  0:00:05 (xfr#12, to-chk=34/56)"
                //   "   3851813 100%  15.35MB/s  0:00:00 (xfer#1, to-check=3/132)"
                const match = msg.match(/([\d,]+)\s+(\d+)%.*?to-ch(?:k|eck)=(\d+)\/(\d+)/);
                if (match && onProgress) {
                    const bytes = parseInt(match[1].replace(/,/g, ""), 10);
                    const remaining = parseInt(match[3], 10);
                    const totalToCheck = parseInt(match[4], 10);
                    const processedFiles = Math.max(0, totalToCheck - remaining);
                    // rsync counts only what it was given, so its figure is offset by the
                    // files that never entered the list. Without that the bar of an
                    // incremental would start at zero out of the full source and jump.
                    onProgress(bytes, totalBytes, unchangedFiles + Math.min(processedFiles, transferFiles), totalFiles);
                }

                // rsync narrates every file and every progress tick on stdout. Execution logs are
                // stored as a single JSON string on the run, so forwarding that puts one line per
                // file - several for a large one - into the database on every backup: thousands
                // of lines for a real source, burying the events that matter. Progress is already
                // reported through onProgress and the totals are summarised below, so only what
                // rsync sends to stderr (warnings, refusals) earns a line here.
                if (onLog && level && level !== "info") onLog(msg, level, type, details);
            }, options?.signal);

            if (onProgress) onProgress(totalBytes, totalBytes, totalFiles, totalFiles);
            if (onLog) onLog(`Rsync directory download completed: ${transferFiles} file(s), ${totalBytes} bytes`, "info", "storage");

            return { files: totalFiles, bytes: totalBytes, entries: resultEntries, failures: [] };
        } catch (error: unknown) {
            // A transfer torn down by the cancellation is a cancelled run, not a source that
            // failed. Logged as an error it would leave a red line in the history of a run
            // whose only story is that someone stopped it.
            if (options?.signal?.aborted) throw error;
            log.error("Rsync directory download failed", { host: config.host, remotePath }, wrapError(error));
            if (onLog) onLog(`Rsync directory download failed: ${sanitizeError(error)}`, "error", "storage");
            throw error;
        } finally {
            if (keyFile) await fs.unlink(keyFile).catch(() => {});
            if (listFile) await fs.unlink(listFile).catch(() => {});
        }
    },

    async read(config: RsyncConfig, remotePath: string): Promise<string | null> {
        const tmpPath = path.join(os.tmpdir(), `rsync-read-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        let keyFile: string | undefined;
        try {
            if (config.authType === "privateKey" && config.privateKey) {
                keyFile = await writeTempKey(config.privateKey);
            }

            // Use SSH cat for small files (like .meta.json) - faster than rsync
            try {
                const fullPath = path.posix.join(config.pathPrefix, remotePath);
                const content = await execSSH(config, `cat '${shellEscapeSingleQuote(fullPath)}'`, keyFile);
                return content;
            } catch {
                // Fallback: download via rsync
                const source = buildRemotePath(config, remotePath);
                await runRsync(await buildRsyncArgs(config, keyFile), { source, destination: tmpPath });
                return await fs.readFile(tmpPath, "utf-8");
            }
        } catch {
            // Quietly fail if file not found (expected for missing .meta.json)
            return null;
        } finally {
            if (keyFile) await fs.unlink(keyFile).catch(() => {});
            await fs.unlink(tmpPath).catch(() => {});
        }
    },

    /**
     * Serves a byte range by opening SFTP on the same SSH server.
     *
     * rsync has no notion of partial reads, but this adapter always speaks SSH - same host,
     * port and credentials - and SFTP is a subsystem of that server. So a single-file
     * restore can fetch just that file instead of the whole archive, provided the server
     * offers the subsystem. Where it does not (a hardened rsync-only account, say), this
     * throws and the caller falls back to fetching the archive once.
     */
    async downloadRange(config: RsyncConfig, remotePath: string, start: number, end: number): Promise<NodeJS.ReadableStream> {
        // An empty range is legal - a zero-length file's archive entry produces one.
        if (end < start) return Readable.from([]);

        const sftp = await connectSFTP(config as unknown as SFTPConfig);
        const source = config.pathPrefix ? path.posix.join(config.pathPrefix, remotePath) : remotePath;

        try {
            // createReadStream's `end` is inclusive, matching the capability's contract.
            const stream = sftp.createReadStream(source, { start, end }) as NodeJS.ReadableStream;
            // The session has to outlive the stream, so it is closed on completion rather
            // than in a finally block here.
            const close = () => { void endSftpClient(sftp); };
            stream.on("end", close);
            stream.on("error", close);
            stream.on("close", close);
            return stream;
        } catch (error) {
            await endSftpClient(sftp);
            log.error("Rsync ranged download via SFTP failed", { host: config.host, remotePath, start, end }, wrapError(error));
            throw error;
        }
    },

    async list(config: RsyncConfig, dir: string = ""): Promise<FileInfo[]> {
        return (await findRemoteEntries(config, dir, false)).files;
    },

    /**
     * Collection walk, which is `list()` plus symbolic links.
     *
     * Kept apart deliberately. `list()` also serves retention, integrity checks and the
     * destination browser over directories of backup files, where a link has no meaning and
     * where changing what is returned would change what retention considers deletable.
     */
    async listTree(config: RsyncConfig, dir: string = ""): Promise<ListTreeResult> {
        const { files, unsupportedSymlinks } = await findRemoteEntries(config, dir, true);
        return { files, pruned: [], ...(unsupportedSymlinks.length > 0 ? { unsupportedSymlinks } : {}) };
    },

    async browseDirectories(config: RsyncConfig, subPath: string = ""): Promise<DirectoryBrowseEntry[]> {
        let keyFile: string | undefined;
        try {
            if (config.authType === "privateKey" && config.privateKey) {
                keyFile = await writeTempKey(config.privateKey);
            }

            const startDir = path.posix.join(config.pathPrefix, subPath);
            const safeStartDir = shellEscapeSingleQuote(startDir);
            // Whole paths rather than GNU find's -printf, which the BSD find of macOS lacks, and
            // which left the list empty there. The last part of each path is the name.
            const output = await execSSH(
                config,
                `find '${safeStartDir}' -mindepth 1 -maxdepth 1 -type d 2>/dev/null`,
                keyFile,
                undefined,
                LISTING_LIMITS
            );

            if (!output) return [];
            return output
                .split("\n")
                .map((line) => path.posix.basename(line.replace(/\r$/, "")))
                .filter(Boolean)
                .map((name) => ({ name, path: subPath ? `${subPath}/${name}` : name }));
        } catch (error: unknown) {
            log.error("Rsync browseDirectories failed", { host: config.host, subPath }, wrapError(error));
            throw error;
        } finally {
            if (keyFile) await fs.unlink(keyFile).catch(() => {});
        }
    },

    async delete(config: RsyncConfig, remotePath: string): Promise<boolean> {
        let keyFile: string | undefined;
        try {
            if (config.authType === "privateKey" && config.privateKey) {
                keyFile = await writeTempKey(config.privateKey);
            }

            const fullPath = path.posix.join(config.pathPrefix, remotePath);

            await execSSH(config, `rm -f '${shellEscapeSingleQuote(fullPath)}'`, keyFile);
            return true;
        } catch (error: unknown) {
            log.error("Rsync delete failed", { host: config.host, remotePath }, wrapError(error));
            return false;
        } finally {
            if (keyFile) await fs.unlink(keyFile).catch(() => {});
        }
    },

    async ping(config: RsyncConfig): Promise<{ success: boolean; message: string }> {
        let keyFile: string | undefined;
        try {
            if (config.authType === "privateKey" && config.privateKey) {
                keyFile = await writeTempKey(config.privateKey);
            }
            await execSSH(config, `echo ping`, keyFile);
            return { success: true, message: "Connection successful" };
        } catch (error: unknown) {
            return { success: false, message: `Rsync connection failed: ${sanitizeError(error)}` };
        } finally {
            if (keyFile) await fs.unlink(keyFile).catch(() => {});
        }
    },

    async test(config: RsyncConfig): Promise<{ success: boolean; message: string }> {
        let keyFile: string | undefined;
        const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
        const testFileName = `connection-test-rsync-${ts}`;
        const tmpPath = path.join(os.tmpdir(), testFileName);
        const testSubdir = path.posix.join(config.pathPrefix, '.dbackup/test');
        let remoteFileCreated = false;
        try {
            if (config.authType === "privateKey" && config.privateKey) {
                keyFile = await writeTempKey(config.privateKey);
            }

            // Ensure remote directory exists
            try {
                await execSSH(config, `mkdir -p '${shellEscapeSingleQuote(config.pathPrefix)}'`, keyFile);
            } catch (mkdirError: unknown) {
                const errMsg = sanitizeError(mkdirError);
                if (errMsg.toLowerCase().includes("permission denied")) {
                    return {
                        success: false,
                        message: `Permission denied: Cannot create directory '${config.pathPrefix}'. Ensure the user '${config.username}' has write access, or use a path within the user's home directory (e.g. ~/backups).`,
                    };
                }
                throw mkdirError;
            }

            // Ensure test subfolder exists
            await execSSH(config, `mkdir -p '${shellEscapeSingleQuote(testSubdir)}'`, keyFile);

            // 1. Write Test - create temp file and rsync it to subfolder
            await fs.writeFile(tmpPath, "Connection Test");

            const destination = buildRemotePath(config, `.dbackup/test/${testFileName}`);
            await runRsync(await buildRsyncArgs(config, keyFile), { source: tmpPath, destination });
            remoteFileCreated = true;

            // 2. Delete Test
            const fullPath = path.posix.join(testSubdir, testFileName);
            await execSSH(config, `rm -f '${shellEscapeSingleQuote(fullPath)}'`, keyFile);
            remoteFileCreated = false;

            return { success: true, message: "Connection successful (Write/Delete verified)" };
        } catch (error: unknown) {
            return { success: false, message: `Rsync connection failed: ${sanitizeError(error)}` };
        } finally {
            if (remoteFileCreated) {
                const fullPath = path.posix.join(testSubdir, testFileName);
                await execSSH(config, `rm -f '${shellEscapeSingleQuote(fullPath)}'`, keyFile).catch(() => {});
            }
            if (keyFile) await fs.unlink(keyFile).catch(() => {});
            await fs.unlink(tmpPath).catch(() => {});
        }
    },
};
