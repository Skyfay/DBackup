import { StorageAdapter, StorageSession, FileInfo } from "@/lib/core/interfaces";
import { RsyncSchema } from "@/lib/adapters/definitions";
import Rsync from "rsync";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

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
 * Strips sensitive data (passwords, keys, key paths) from command strings for safe logging.
 * IMPORTANT: Never log raw commands - always sanitize first.
 */
function sanitizeCommand(cmd: string): string {
    return cmd
        .replace(/sshpass\s+-e\s+/g, "sshpass -e ")
        .replace(/sshpass\s+-p\s+'[^']*'/g, "sshpass -p '***'")
        .replace(/sshpass\s+-p\s+"[^"]*"/g, 'sshpass -p "***"')
        .replace(/sshpass\s+-p\s+\S+/g, "sshpass -p ***")
        .replace(/-i\s+\/[^\s]+/g, "-i ***")
        .replace(/SSHPASS=[^\s]+/g, "SSHPASS=***");
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
 * Builds the SSH command string for rsync's -e flag (never contains passwords).
 */
function buildSshCommand(config: RsyncConfig, keyFile?: string): string {
    const parts = ["ssh", `-p ${config.port}`, "-o StrictHostKeyChecking=no"];

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
function buildSshArgArray(config: RsyncConfig, keyFile?: string): string[] {
    const args = ["-p", String(config.port), "-o", "StrictHostKeyChecking=no"];

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

/**
 * Executes an SSH command on the remote host.
 * Uses execFile (no shell) to prevent command injection via config values.
 * Uses SSHPASS env var for password auth (never passes password on command line).
 */
async function execSSH(config: RsyncConfig, command: string, keyFile?: string): Promise<string> {
    const sshArgs = buildSshArgArray(config, keyFile);
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

    try {
        const { stdout } = await execFileAsync(binary, args, { timeout: 30000, env });
        return stdout.trim();
    } catch (error: unknown) {
        // Re-throw with sanitized message (strips raw command from exec errors)
        throw new Error(sanitizeError(error));
    }
}

/**
 * Wraps rsync.execute in a Promise.
 * All error messages are sanitized to prevent password/key leaks.
 */
function executeRsync(rsync: Rsync, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        rsync.execute(
            (error: Error | null, code: number, cmd: string) => {
                if (error) {
                    reject(new Error(`rsync exited with code ${code}: ${sanitizeCommand(error.message)} (cmd: ${sanitizeCommand(cmd)})`));
                } else {
                    resolve();
                }
            },
            (data: Buffer) => {
                const line = data.toString().trim();
                if (line && onLog) {
                    onLog(line, "info", "storage");
                }
            },
            (data: Buffer) => {
                const line = data.toString().trim();
                if (line && onLog) {
                    onLog(sanitizeCommand(`stderr: ${line}`), "warning", "storage");
                }
            }
        );
    });
}

/**
 * Creates a configured Rsync instance with shell and auth settings.
 * For password auth, uses SSHPASS env var via sshpass -e.
 * Must be called after checkSshpass() for password auth.
 */
async function createRsyncInstance(config: RsyncConfig, keyFile?: string): Promise<Rsync> {
    const rsync = new Rsync()
        .flags("az")
        .set("partial")
        .set("progress");

    const sshCmd = buildSshCommand(config, keyFile);

    // For password auth, prepend sshpass -e (reads password from SSHPASS env var)
    if (config.authType === "password" && config.password) {
        if (!await checkSshpass()) {
            throw new Error("Password authentication requires 'sshpass' to be installed. Install it or use SSH key / agent authentication instead.");
        }
        rsync.shell(`sshpass -e ${sshCmd}`);
        rsync.env({ ...process.env, SSHPASS: config.password } as Record<string, string>);
    } else {
        rsync.shell(sshCmd);
    }

    // Apply additional user-defined options
    if (config.options) {
        const extraArgs = config.options.split(/\s+/).filter(Boolean);
        for (const arg of extraArgs) {
            const cleaned = arg.replace(/^-+/, "");
            if (cleaned.length === 1) {
                rsync.flags(cleaned);
            } else {
                const [key, ...rest] = cleaned.split("=");
                rsync.set(key, rest.length > 0 ? rest.join("=") : undefined as any);
            }
        }
    }

    return rsync;
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
    dirCache: Set<string>
): Promise<boolean> {
    try {
        const destination = buildRemotePath(config, remotePath);
        const remoteDir = path.posix.dirname(path.posix.join(config.pathPrefix, remotePath));

        if (!dirCache.has(remoteDir)) {
            if (onLog) onLog(`Ensuring remote directory: ${remoteDir}`, "info", "storage");
            try {
                await execSSH(config, `mkdir -p '${shellEscapeSingleQuote(remoteDir)}'`, keyFile);
            } catch (e) {
                log.warn("Could not create remote directory via SSH, rsync may handle it", {}, wrapError(e));
            }
            dirCache.add(remoteDir);
        }

        if (onLog) onLog(`Starting rsync upload to: ${config.host}:${remotePath}`, "info", "storage");

        const rsync = await createRsyncInstance(config, keyFile);
        rsync.source(localPath);
        rsync.destination(destination);

        let lastPercent = 0;
        await executeRsync(rsync, (msg, level, type, details) => {
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
        const dirCache = new Set<string>();
        return {
            upload: (localPath, remotePath, onProgress, uploadLog) =>
                performRsyncUpload(config, keyFile, localPath, remotePath, onProgress, uploadLog ?? onLog, dirCache),
            close: async () => {
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

            const rsync = await createRsyncInstance(config, keyFile);
            const source = buildRemotePath(config, remotePath);

            rsync.source(source);
            rsync.destination(localPath);

            await executeRsync(rsync, (msg, level, type, details) => {
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
                const rsync = await createRsyncInstance(config, keyFile);

                rsync.source(source);
                rsync.destination(tmpPath);

                await executeRsync(rsync);
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

    async list(config: RsyncConfig, dir: string = ""): Promise<FileInfo[]> {
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

            // Use SSH find command to recursively list files
            const safeStartDir = shellEscapeSingleQuote(startDir);
            const output = await execSSH(
                config,
                `find '${safeStartDir}' -type f -printf '%p\\t%s\\t%T@\\n' 2>/dev/null || find '${safeStartDir}' -type f -exec stat -f '%N\\t%z\\t%m' {} \\; 2>/dev/null`,
                keyFile
            );

            if (!output) return [];

            const files: FileInfo[] = [];
            for (const line of output.split("\n")) {
                if (!line.trim()) continue;

                const parts = line.split("\t");
                if (parts.length < 3) continue;

                const [filePath, sizeStr, modifiedStr] = parts;
                const size = parseInt(sizeStr, 10) || 0;
                const modified = parseFloat(modifiedStr) || 0;

                // Calculate relative path (strip prefix)
                let relativePath = normalize(filePath);
                if (prefix && relativePath.startsWith(prefix)) {
                    relativePath = relativePath.substring(prefix.length);
                }
                if (relativePath.startsWith("/")) relativePath = relativePath.substring(1);

                files.push({
                    name: path.basename(filePath),
                    path: relativePath,
                    size,
                    lastModified: new Date(modified * 1000),
                });
            }

            return files;
        } catch (error: unknown) {
            log.error("Rsync list failed", { host: config.host, dir }, wrapError(error));
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
            const rsync = await createRsyncInstance(config, keyFile);

            rsync.source(tmpPath);
            rsync.destination(destination);

            await executeRsync(rsync);
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
