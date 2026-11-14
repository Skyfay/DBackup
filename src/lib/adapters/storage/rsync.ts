import { StorageAdapter, StorageSession, FileInfo, DirectoryDownloadOptions, DirectoryDownloadResult, DirectoryFileEntry, DirectoryBrowseEntry, ListTreeResult, StorageReadOptions, UploadOptions } from "@/lib/core/interfaces";
import { relativeToPrefix } from "@/lib/adapters/storage/common/prefix";
import { assertReadSize, FileTooLargeError, isFileTooLarge, readLimitOf, textOf } from "@/lib/adapters/storage/common/read-limit";
import { createListingGuard } from "@/lib/adapters/storage/common/listing-limits";
import { RsyncSchema, type SFTPConfig } from "@/lib/adapters/definitions";
import { connectSFTP, endSftpClient } from "./sftp";
import { Readable } from "stream";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import { randomBytes, randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { getTempDir } from "@/lib/temp-dir";
import { READ_NO_FOLLOW } from "@/lib/server/no-follow";
import { withPrivateTempDir, writeNewFile } from "@/lib/private-temp-dir";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { refuseListedNames, toRelativePath } from "./common/download-directory";
import { matchesAnyExcludePattern } from "@/lib/exclude-patterns";
import { formatExcludeSummary, summariseExcluded } from "@/lib/exclude-summary";
import { runRsync, sanitizeCommand, type RsyncCommand } from "./rsync-process";
import { assertRestoreDirAnswer, restoreDirCommand, writesInPlace } from "./rsync-restore-dir";
import { restoreFolderOf } from "./common/restore-folder";
import { rsyncUsernameProblem } from "./rsync-user";
import type { DialAddress } from "./rsync-pin";
import type { KnownHosts } from "./rsync-host-key";
import { plainHost, validPort } from "@/lib/adapters/command-values";
import { assertKeyCost } from "@/lib/transport/key-cost";
import { opensshHostKeyOptions, opensshRefusal } from "@/lib/transport/host-key-openssh";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const log = logger.child({ adapter: "rsync" });

interface RsyncConfig extends DialAddress, KnownHosts {
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
    // The same limits as every other SSH client, so a key is refused alike wherever it is used.
    assertKeyCost(privateKey);
    // A random name and an exclusive create, so a link planted in the shared temp folder never
    // receives the key.
    const tmpFile = path.join(getTempDir(), `rsync-key-${randomUUID()}`);
    await fs.writeFile(tmpFile, privateKey, { mode: 0o600, flag: "wx" });
    return tmpFile;
}

/**
 * Writes the relative paths a directory download transfers to a temporary file for
 * `--files-from`, each ended by a NUL for `--from0`, since a file name may hold a newline.
 * Returns the path to the temp file. Caller must delete it after use.
 */
async function writeFileList(relativePaths: string[]): Promise<string> {
    const tmpFile = path.join(getTempDir(), `rsync-files-${randomUUID()}`);
    await fs.writeFile(tmpFile, relativePaths.map((relativePath) => `${relativePath}\0`).join(""), { mode: 0o600, flag: "wx" });
    return tmpFile;
}

/**
 * How every SSH call of this adapter treats the server's host key, decided in `host-key-openssh.ts`:
 * checked against the `known_hosts` file `rsync-host-key.ts` wrote for the call, or accepted
 * unchecked for a connection with the check switched off, which gets no file.
 */
const sshHostKeyOptions = (config: RsyncConfig): string[] =>
    opensshHostKeyOptions(config.knownHostsFile ? { file: config.knownHostsFile, pinned: config.strictHostKey === true } : undefined);

/** Tells the check of the call when ssh refused the host key of the server, see `rsync-host-key.ts`. */
function noteHostKeyRefusal(config: RsyncConfig, error: unknown): void {
    const failure = error as { message?: unknown; stderr?: unknown } | null;
    const refusal = opensshRefusal(`${String(failure?.message ?? "")}\n${String(failure?.stderr ?? "")}`);
    if (refusal) config.onHostKeyRefused?.(refusal.presented);
}

/**
 * The SSH port of the connection as a whole number from 1 to 65535. rsync splits the `-e` command
 * into words itself, so a port stored as text like `22 -o ProxyCommand=...` would add options to ssh
 * that run a command on the server DBackup runs on. Checked here as well as on save, since a config
 * may predate that check.
 */
function sshPortOf(config: RsyncConfig): number {
    return validPort(config.port, "rsync", 22);
}

/**
 * Builds the SSH command string for rsync's -e flag (never contains passwords).
 */
function buildSshCommand(config: RsyncConfig, keyFile?: string, controlPath?: string): string {
    const parts = ["ssh", `-p ${sshPortOf(config)}`, ...sshHostKeyOptions(config).map((option) => `-o ${option}`)];

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
    const args = ["-p", String(sshPortOf(config)), ...sshHostKeyOptions(config).flatMap((option) => ["-o", option])];

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
 * The login of every command, `user@host`, once the username is a plain login name. rsync and
 * OpenSSH read the host after the last `@`, so a name like `alice@corp.local` still reaches the
 * host of the connection. rsync ends the host at a `:` and OpenSSH takes a leading `-` for an
 * option, so a name with one would reach another host or another option, see `rsync-user.ts`.
 * Checked here as well as on save, since a profile may predate the rule.
 *
 * The host the same way, see `plainHost`: rsync hands it to ssh as an argument of its own, where a
 * leading `-` is an option, takes a spec with a `/` before the `:` for a local path of the server
 * DBackup runs on, and ends the host at a `:`, so an IPv6 address goes in brackets.
 */
export function sshTarget(config: RsyncConfig, inRsyncPath = false): string {
    const problem = rsyncUsernameProblem(config.username);
    if (problem) throw new Error(problem);
    const host = plainHost(config.host, "rsync");
    // The address checked for a tenant that blocks the local network, see `rsync-pin.ts`. OpenSSH
    // takes an IPv6 address bare, rsync in brackets, since it ends the host of a path at a `:`.
    const dial = config.dialAddress && inRsyncPath && config.dialAddress.includes(":") ? `[${config.dialAddress}]` : config.dialAddress;
    return `${config.username}@${dial ?? host}`;
}

/**
 * A remote path as the argument of a command on the server: a relative one gets `./` in front, so a
 * folder setting or a job called like `-x` never reads as an option of `find`, `mkdir`, `cat`, `rm`
 * or the rsync on the other end. A path from the home folder stays as it is, since the remote shell
 * expands the `~` of an rsync path, and it never starts with `-` anyway.
 */
export function remoteArgument(remotePath: string): string {
    return remotePath.startsWith("/") || remotePath.startsWith("~") || remotePath.startsWith("./") ? remotePath : `./${remotePath}`;
}

/**
 * Builds the remote path for rsync (user@host:path).
 */
function buildRemotePath(config: RsyncConfig, relativePath: string): string {
    const fullPath = path.posix.join(config.pathPrefix, relativePath);
    return `${sshTarget(config, true)}:${remoteArgument(fullPath)}`;
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
 * What `-a` brings along that a collection never wants, switched off again after the options of
 * the connection, which may hold `-a` themselves.
 *
 * Devices, named pipes and sockets of the server are no files of a backup, and the owner and group
 * of the server set on the files of the collection folder would hand them to whichever account
 * shares those ids on the machine DBackup runs on, root included. Links are left out too: the
 * listing names every link with its target, and the archive takes them from there, never from the
 * collection folder, which then holds no link that a later file of the same transfer could be
 * written through. The long forms rather than `--no-D`, and an rsync that refuses them is found
 * once, see `supportsCollectionFlags`.
 */
export const COLLECTION_FLAGS = ["--no-devices", "--no-specials", "--no-owner", "--no-group", "--no-links"] as const;

/**
 * The flags of a transfer of one file, a download or the fallback of a read, after the options of
 * the connection, which may hold `-a` and with it `-r`. A remote path that names a folder then
 * transfers nothing rather than the whole folder, and the download finds no file and fails, see
 * `downloaded-file.ts`. Never for `downloadDirectory`, which transfers a folder on purpose.
 */
export const SINGLE_FILE_FLAGS = ["--no-recursive", "--no-dirs"] as const;

/**
 * Whether the rsync of this machine takes `COLLECTION_FLAGS`, which GNU rsync 3 does, the rsync of
 * the Docker image too. One that refuses them transfers nothing from a server, see
 * `collectionFlags`. Probed once and cached for the process lifetime, like the checks around it.
 */
let _collectionFlagsSupported: boolean | null = null;
async function supportsCollectionFlags(): Promise<boolean> {
    if (_collectionFlagsSupported !== null) return _collectionFlagsSupported;
    try {
        await execFileAsync("rsync", [...COLLECTION_FLAGS, "--version"], { timeout: 5000 });
        _collectionFlagsSupported = true;
    } catch {
        _collectionFlagsSupported = false;
    }
    return _collectionFlagsSupported;
}

/**
 * The flags of every transfer from a server: a collection, a download and a read. They come after
 * the options of the connection, which may hold `-a`, so they win.
 *
 * Without them `-a` recreates a link of the server as a link on this machine, and whatever reads
 * the file then reads the file of this machine it points at. An rsync that refuses them therefore
 * fails the transfer rather than running with `-a` alone.
 */
async function collectionFlags(): Promise<string[]> {
    if (await supportsCollectionFlags()) return [...COLLECTION_FLAGS];
    log.error("This rsync does not take the flags that keep links, devices and owners of a server off this machine");
    throw new Error(
        "The rsync of the DBackup server does not take --no-links and the flags beside it, which keep links, devices and owners of the remote server off this machine. Install GNU rsync 3 there, which the Docker image ships."
    );
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
    return (await execSSHBytes(config, command, keyFile, controlPath, options)).toString("utf8").trim();
}

/** `execSSH` with the output as the bytes the server printed, neither decoded nor trimmed. */
async function execSSHBytes(config: RsyncConfig, command: string, keyFile?: string, controlPath?: string, options: SshExecOptions = {}): Promise<Buffer> {
    const sshArgs = buildSshArgArray(config, keyFile, controlPath);
    const target = sshTarget(config);
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
        const { stdout } = await execFileAsync(binary, args, { timeout, env, encoding: "buffer", ...(options.maxBuffer ? { maxBuffer: options.maxBuffer } : {}) });
        return Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout));
    } catch (error: unknown) {
        const failure = error as { code?: unknown; killed?: boolean };
        if (failure?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            const limit = Math.round((options.maxBuffer ?? 1024 * 1024) / (1024 * 1024));
            throw new Error(`The server answered with more than ${limit} MB. Back up its subfolders as separate sources.`);
        }
        if (failure?.killed) throw new Error(`The server did not finish within ${Math.round(timeout / 1000)} seconds.`);
        noteHostKeyRefusal(config, error);
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
    const args = [...buildSshArgArray(config, keyFile, controlPath), "-O", "exit", sshTarget(config)];
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

        // `find` prints each path the way it was given the folder, so the `./` that keeps a folder
        // like `-x` from reading as an option comes off each line again below.
        const argument = remoteArgument(startDir);
        const added = argument !== startDir;
        const safeStartDir = shellEscapeSingleQuote(argument);
        const selector = includeSymlinks ? `\\( -type f -o -type l \\)` : `-type f`;
        const listing = `find '${safeStartDir}' ${selector} -printf '%p\\t%s\\t%T@\\t%y\\t%l\\n' 2>/dev/null || find '${safeStartDir}' -type f -exec stat -f '%N\\t%z\\t%m' {} \\; 2>/dev/null`;
        // A subfolder nothing was written to yet is not there, and `find` fails on it. The test in
        // front ends the command right there with no output, which lists as empty like on the
        // other destinations. A missing root has no test in front, so its `find` still fails.
        const command = dir !== "" ? `[ ! -e '${safeStartDir}' ] || ${listing}` : listing;
        const output = await execSSH(
            config,
            command,
            keyFile,
            undefined,
            LISTING_LIMITS
        );

        if (!output) return { files: [], unsupportedSymlinks: [] };

        const files: FileInfo[] = [];
        // A GNU run always emits the type column. Its absence means the BSD fallback ran, so
        // links were never selected in the first place and the caller has to be told.
        let sawTypeColumn = false;
        // Every entry passes the guard first, see `listing-limits.ts`. The output itself is bounded
        // by `LISTING_LIMITS`, the entries made of it by this.
        const guard = createListingGuard();

        for (const line of output.split("\n")) {
            if (!line.trim()) continue;

            const parts = line.split("\t");
            if (parts.length < 3) continue;

            const [printed, sizeStr, modifiedStr, type, linkTarget] = parts;
            const filePath = added && printed.startsWith("./") ? printed.slice(2) : printed;
            const size = parseInt(sizeStr, 10) || 0;
            const modified = parseFloat(modifiedStr) || 0;
            if (type) sawTypeColumn = true;

            // The path below the folder setting, compared as `find` prints it, so `./backups` or
            // `/srv//backups` strips like `backups` and `/srv/backups`.
            const relativePath = relativeToPrefix(filePath, prefix);

            const isLink = type === "l";
            if (isLink && !linkTarget) continue;
            guard.add(relativePath, isLink ? linkTarget : undefined);

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

    return { args, ...(env ? { env } : {}), ...(config.onHostKeyRefused ? { onHostKeyRefused: config.onHostKeyRefused } : {}) };
}

/**
 * Creates the folders of a write of a restore on the server and refuses one below the folder of
 * the restore that leads out of it, see `rsync-restore-dir.ts`. Unlike the `mkdir -p` of a backup
 * it has to succeed: a server that runs no command leaves the folders unchecked, so the write is
 * refused. Each folder is checked once per session, unless the options of the connection write in
 * place, where a link at the name of each file is removed first.
 */
async function ensureRestoreDir(
    config: RsyncConfig,
    keyFile: string | undefined,
    remotePath: string,
    relativePath: string,
    dirCache: Set<string>,
    controlPath: string | undefined,
    onLog: ((msg: string, level?: LogLevel, type?: LogType, details?: string) => void) | undefined
): Promise<void> {
    const below = relativePath.replace(/\\/g, "/");
    const folder = path.posix.join(config.pathPrefix, restoreFolderOf(remotePath, relativePath)) || ".";
    const remoteDir = path.posix.dirname(path.posix.join(config.pathPrefix, remotePath));
    const inPlace = writesInPlace(config.options);
    const checked = `restore:${remoteDir}`;
    if (dirCache.has(checked) && !inPlace) return;

    if (onLog && !dirCache.has(checked)) onLog(`Ensuring remote directory: ${remoteDir}`, "info", "storage");
    const command = restoreDirCommand({
        folder: remoteArgument(folder),
        parts: path.posix.dirname(below).split("/").filter((part) => part !== "" && part !== "."),
        ...(inPlace ? { removeLeafLink: path.posix.basename(below) } : {}),
    });
    let answer: string;
    try {
        answer = await execSSH(config, command, keyFile, controlPath);
    } catch (error) {
        log.warn("Could not check the folders of a restore via SSH", { host: config.host }, wrapError(error));
        answer = "";
    }
    assertRestoreDirAnswer(answer, remoteDir);
    dirCache.add(checked);
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
    controlPath?: string,
    options?: UploadOptions
): Promise<boolean> {
    try {
        const destination = buildRemotePath(config, remotePath);
        const remoteDir = path.posix.dirname(path.posix.join(config.pathPrefix, remotePath));

        if (options?.restoreRelativePath !== undefined) {
            // A write of a restore never follows a link out of the folder of the restore, see `rsync-restore-dir.ts`.
            await ensureRestoreDir(config, keyFile, remotePath, options.restoreRelativePath, dirCache, controlPath, onLog);
        } else if (!dirCache.has(remoteDir)) {
            if (onLog) onLog(`Ensuring remote directory: ${remoteDir}`, "info", "storage");
            try {
                await execSSH(config, `mkdir -p '${shellEscapeSingleQuote(remoteArgument(remoteDir))}'`, keyFile, controlPath);
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

/**
 * The bytes of a file, at most the limit of the read, see `read-limit.ts`. Null when the file is
 * not there.
 *
 * `head -c` over SSH first, faster than rsync for a small file like a `.meta.json`, which prints
 * one byte past the limit at most. A server without it, like an account limited to rsync, gets
 * rsync with `--max-size`, which leaves a larger file out instead of transferring it.
 */
async function readCappedBytes(config: RsyncConfig, remotePath: string, options?: StorageReadOptions): Promise<Buffer | null> {
    const limit = readLimitOf(options);
    let keyFile: string | undefined;
    try {
        if (config.authType === "privateKey" && config.privateKey) {
            keyFile = await writeTempKey(config.privateKey);
        }

        try {
            const fullPath = path.posix.join(config.pathPrefix, remotePath);
            const bytes = await execSSHBytes(
                config,
                `head -c ${limit + 1} '${shellEscapeSingleQuote(remoteArgument(fullPath))}'`,
                keyFile,
                undefined,
                { maxBuffer: limit + 1 }
            );
            assertReadSize(bytes.length, limit);
            return bytes;
        } catch (error) {
            if (isFileTooLarge(error)) throw error;
            // Fallback: download via rsync
            const source = buildRemotePath(config, remotePath);
            const args = await buildRsyncArgs(config, keyFile);
            // The flags of a collection keep a link of the server from being recreated here.
            const extra = [...(await collectionFlags()), ...SINGLE_FILE_FLAGS, `--max-size=${limit}`];
            return await withPrivateTempDir("rsync-read-", async (dir) => {
                const tmpPath = path.join(dir, "read");
                await runRsync(args, { source, destination: tmpPath, extra });
                let handle: fs.FileHandle;
                try {
                    handle = await fs.open(tmpPath, READ_NO_FOLLOW);
                } catch (openError) {
                    // rsync succeeded and wrote nothing, so `--max-size` left the file out,
                    // `--no-links` a link or `--no-dirs` a folder. Either way nothing of it is read.
                    if ((openError as NodeJS.ErrnoException)?.code === "ENOENT") throw new FileTooLargeError(limit);
                    throw openError;
                }
                try {
                    const stats = await handle.stat();
                    if (!stats.isFile()) throw new Error("The read of rsync left no regular file");
                    assertReadSize(stats.size, limit);
                    return await handle.readFile();
                } finally {
                    await handle.close();
                }
            });
        }
    } catch (error) {
        if (isFileTooLarge(error)) throw error;
        // Quietly fail if file not found (expected for missing .meta.json)
        return null;
    } finally {
        if (keyFile) await fs.unlink(keyFile).catch(() => {});
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
        const controlPath = path.join(getTempDir(), `dbackup-rsync-${randomBytes(8).toString("hex")}`);

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
                    upload: (localPath, remotePath, onProgress, uploadLog, options) =>
                        performRsyncUpload(config, keyFile, localPath, remotePath, onProgress, uploadLog ?? onLog, new Set(), undefined, options),
                    close: async () => { await fs.unlink(keyFile!).catch(() => { }); },
                };
            }
            return {
                upload: (localPath, remotePath, onProgress, uploadLog, options) =>
                    performRsyncUpload(config, undefined, localPath, remotePath, onProgress, uploadLog ?? onLog, new Set(), undefined, options),
                close: async () => { },
            };
        }

        const dirCache = new Set<string>();
        return {
            upload: (localPath, remotePath, onProgress, uploadLog, options) =>
                performRsyncUpload(config, keyFile, localPath, remotePath, onProgress, uploadLog ?? onLog, dirCache, controlPath, options),
            close: async () => {
                // Tell the master to exit rather than waiting out ControlPersist, so the run does
                // not leave an authenticated connection open behind it.
                await closeSshMaster(config, keyFile, controlPath);
                await fs.unlink(controlPath).catch(() => { });
                if (keyFile) await fs.unlink(keyFile).catch(() => { });
            },
        };
    },

    async upload(config: RsyncConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, options?: UploadOptions): Promise<boolean> {
        let keyFile: string | undefined;
        try {
            if (config.authType === "privateKey" && config.privateKey) {
                keyFile = await writeTempKey(config.privateKey);
            }
            return await performRsyncUpload(config, keyFile, localPath, remotePath, onProgress, onLog, new Set(), undefined, options);
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
            // A link of the server is never recreated here, where a reader of the file would follow
            // it into a file of this machine. rsync skips it, and the check of the registry then
            // finds no file, see `downloaded-file.ts`. A folder is skipped the same way.
            const extra = [...(await collectionFlags()), ...SINGLE_FILE_FLAGS];

            await runRsync(command, { source, destination: localPath, extra }, (msg, level, type, details) => {
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

            // listTree(), not list(): the collection needs symbolic links, and the listing is the
            // one place they come from, with their target. The transfer leaves them out, see
            // `COLLECTION_FLAGS`, and the archive stores each as a link from its index line.
            const { files: allFiles, unsupportedSymlinks } = await RsyncAdapter.listTree!(config, remotePath);
            if (unsupportedSymlinks?.length && onLog) {
                onLog(
                    `Symbolic links under ${remotePath} could not be collected: the remote 'find' does not support -printf. They are missing from this backup.`,
                    "warning", "storage"
                );
            }

            // The server answers `find` with whatever it likes, so a name that cannot be a file of
            // the collection folder, like `../../x` or one with a NUL, is refused here by the rule
            // the generic collection uses. It never reaches the list rsync takes, and the runner
            // checks every name and file once more before it reads one, see `collected-entries.ts`.
            const { kept: listed, refused } = refuseListedNames<DirectoryFileEntry>(allFiles.map((f) => ({
                relativePath: toRelativePath(f.path, remotePath),
                size: f.size,
                lastModified: f.lastModified,
                ...(f.linkTarget !== undefined ? { linkTarget: f.linkTarget } : {}),
            })), onLog);
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
                return { files: 0, bytes: 0, entries: [], failures: refused };
            }

            if (unchangedFiles > 0 && onLog) {
                onLog(`${unchangedFiles} of ${totalFiles} file(s) unchanged, not transferred`, "info", "storage");
            }

            // The chain already holds every file of this source. rsync reads an empty
            // --files-from without complaining, but a transfer that copies nothing still
            // costs an SSH login, so it is skipped outright.
            if (transferFiles === 0) {
                if (onProgress) onProgress(0, 0, totalFiles, totalFiles);
                return { files: totalFiles, bytes: 0, entries: resultEntries, failures: refused };
            }

            await fs.mkdir(localPath, { recursive: true });

            if (onLog) onLog(`Starting rsync directory download from: ${config.host}:${remotePath} (${transferFiles} file(s))`, "info", "storage");

            const command = await buildRsyncArgs(config, keyFile);
            // Without it the transfer still reports progress, just per file rather than as one
            // figure for the whole directory - `--progress` is set either way. The flags of a
            // collection come after the options of the connection, which may hold `-a`, so they win.
            const extra = [
                ...((await supportsInfoProgress()) ? ["--info=progress2"] : []),
                ...(await collectionFlags()),
            ];

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

            return { files: totalFiles, bytes: totalBytes, entries: resultEntries, failures: refused };
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

    async read(config: RsyncConfig, remotePath: string, options?: StorageReadOptions): Promise<string | null> {
        return textOf(await readCappedBytes(config, remotePath, options));
    },

    readBytes: readCappedBytes,

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
            const safeStartDir = shellEscapeSingleQuote(remoteArgument(startDir));
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

            await execSSH(config, `rm -f '${shellEscapeSingleQuote(remoteArgument(fullPath))}'`, keyFile);
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
        const testSubdir = path.posix.join(config.pathPrefix, '.dbackup/test');
        let remoteFileCreated = false;
        try {
            if (config.authType === "privateKey" && config.privateKey) {
                keyFile = await writeTempKey(config.privateKey);
            }

            // Ensure remote directory exists
            try {
                await execSSH(config, `mkdir -p '${shellEscapeSingleQuote(remoteArgument(config.pathPrefix))}'`, keyFile);
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
            await execSSH(config, `mkdir -p '${shellEscapeSingleQuote(remoteArgument(testSubdir))}'`, keyFile);

            // 1. Write Test - a file in a folder of its own, see `withPrivateTempDir`, rsynced to the subfolder
            const destination = buildRemotePath(config, `.dbackup/test/${testFileName}`);
            const args = await buildRsyncArgs(config, keyFile);
            await withPrivateTempDir("rsync-test-", async (dir) => {
                const tmpPath = path.join(dir, testFileName);
                await writeNewFile(tmpPath, "Connection Test");
                await runRsync(args, { source: tmpPath, destination });
            });
            remoteFileCreated = true;

            // 2. Delete Test
            const fullPath = path.posix.join(testSubdir, testFileName);
            await execSSH(config, `rm -f '${shellEscapeSingleQuote(remoteArgument(fullPath))}'`, keyFile);
            remoteFileCreated = false;

            return { success: true, message: "Connection successful (Write/Delete verified)" };
        } catch (error: unknown) {
            return { success: false, message: `Rsync connection failed: ${sanitizeError(error)}` };
        } finally {
            if (remoteFileCreated) {
                const fullPath = path.posix.join(testSubdir, testFileName);
                await execSSH(config, `rm -f '${shellEscapeSingleQuote(remoteArgument(fullPath))}'`, keyFile).catch(() => {});
            }
            if (keyFile) await fs.unlink(keyFile).catch(() => {});
        }
    },
};
