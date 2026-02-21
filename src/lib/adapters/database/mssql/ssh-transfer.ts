import { Client, ConnectConfig, SFTPWrapper } from "ssh2";
import { createReadStream, createWriteStream } from "fs";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";
import { MSSQLConfig } from "@/lib/adapters/definitions";

const log = logger.child({ adapter: "mssql", module: "ssh-transfer" });

/**
 * SSH/SFTP file transfer for MSSQL backup files.
 *
 * Used when the SQL Server is remote and backup .bak files are not
 * accessible via a shared filesystem (Docker volume, NFS, etc.).
 *
 * Flow:
 *   Dump:    SQL Server writes .bak → SSH download to local temp → pipeline continues
 *   Restore: Local .bak → SSH upload to server backup path → SQL Server reads .bak
 */
export class MssqlSshTransfer {
    private client: Client;
    private connected = false;

    constructor() {
        this.client = new Client();
    }

    /**
     * Connect to the SQL Server host via SSH
     */
    public async connect(config: MSSQLConfig): Promise<void> {
        return new Promise((resolve, reject) => {
            const sshConfig: ConnectConfig = {
                host: config.sshHost || config.host, // Default to DB host
                port: config.sshPort || 22,
                username: config.sshUsername,
                readyTimeout: 20000,
            };

            const authType = config.sshAuthType || "password";

            if (authType === "privateKey" && config.sshPrivateKey) {
                sshConfig.privateKey = config.sshPrivateKey;
                if (config.sshPassphrase) {
                    sshConfig.passphrase = config.sshPassphrase;
                }
            } else if (authType === "agent") {
                sshConfig.agent = process.env.SSH_AUTH_SOCK;
            } else {
                sshConfig.password = config.sshPassword;
            }

            this.client
                .on("ready", () => {
                    this.connected = true;
                    resolve();
                })
                .on("error", (err) => {
                    reject(new Error(`SSH connection failed: ${err.message}`));
                })
                .connect(sshConfig);
        });
    }

    /**
     * Download a file from the remote SQL Server to a local path via SFTP
     */
    public async download(remotePath: string, localPath: string): Promise<void> {
        const sftp = await this.getSftp();

        return new Promise((resolve, reject) => {
            const readStream = sftp.createReadStream(remotePath);
            const writeStream = createWriteStream(localPath);

            readStream.on("error", (err: Error) => {
                reject(new Error(`Failed to download ${remotePath}: ${err.message}`));
            });

            writeStream.on("error", (err: Error) => {
                reject(new Error(`Failed to write to ${localPath}: ${err.message}`));
            });

            writeStream.on("finish", () => {
                log.debug("SSH download complete", { remotePath, localPath });
                resolve();
            });

            readStream.pipe(writeStream);
        });
    }

    /**
     * Upload a local file to the remote SQL Server via SFTP
     */
    public async upload(localPath: string, remotePath: string): Promise<void> {
        const sftp = await this.getSftp();

        return new Promise((resolve, reject) => {
            const readStream = createReadStream(localPath);
            const writeStream = sftp.createWriteStream(remotePath);

            readStream.on("error", (err: Error) => {
                reject(new Error(`Failed to read ${localPath}: ${err.message}`));
            });

            writeStream.on("error", (err: Error) => {
                reject(new Error(`Failed to upload to ${remotePath}: ${err.message}`));
            });

            writeStream.on("close", () => {
                log.debug("SSH upload complete", { localPath, remotePath });
                resolve();
            });

            readStream.pipe(writeStream);
        });
    }

    /**
     * Delete a remote file via SFTP
     */
    public async deleteRemote(remotePath: string): Promise<void> {
        const sftp = await this.getSftp();

        return new Promise((resolve) => {
            sftp.unlink(remotePath, (err) => {
                if (err) {
                    log.warn("Failed to delete remote file", { remotePath }, wrapError(err));
                    // Non-fatal: resolve anyway to not block the pipeline
                    resolve();
                } else {
                    log.debug("Deleted remote file", { remotePath });
                    resolve();
                }
            });
        });
    }

    /**
     * Check if a remote file exists
     */
    public async exists(remotePath: string): Promise<boolean> {
        const sftp = await this.getSftp();

        return new Promise((resolve) => {
            sftp.stat(remotePath, (err) => {
                resolve(!err);
            });
        });
    }

    /**
     * Test read/write access to a remote directory via SFTP.
     * Creates a small temp file, verifies it exists, then deletes it.
     *
     * @returns Object with `readable` and `writable` booleans, plus an optional `error` message.
     */
    public async testBackupPath(remotePath: string): Promise<{ readable: boolean; writable: boolean; error?: string }> {
        const sftp = await this.getSftp();

        // 1. Check if directory exists / is readable
        const dirExists = await new Promise<boolean>((resolve) => {
            sftp.stat(remotePath, (err, stats) => {
                if (err) {
                    resolve(false);
                } else {
                    resolve(stats.isDirectory());
                }
            });
        });

        if (!dirExists) {
            return { readable: false, writable: false, error: `Directory does not exist or is not accessible: ${remotePath}` };
        }

        // 2. Try writing a temp probe file
        const probeFile = `${remotePath.replace(/\/$/, '')}/.dbackup_probe_${Date.now()}`;
        const writeOk = await new Promise<boolean>((resolve) => {
            sftp.writeFile(probeFile, "probe", (err) => {
                resolve(!err);
            });
        });

        if (!writeOk) {
            return { readable: true, writable: false, error: `Directory is readable but not writable: ${remotePath}` };
        }

        // 3. Cleanup probe file
        await new Promise<void>((resolve) => {
            sftp.unlink(probeFile, () => resolve());
        });

        return { readable: true, writable: true };
    }

    /**
     * Close the SSH connection
     */
    public end(): void {
        if (this.connected) {
            this.client.end();
            this.connected = false;
        }
    }

    /**
     * Get SFTP subsystem from the SSH connection
     */
    private getSftp(): Promise<SFTPWrapper> {
        return new Promise((resolve, reject) => {
            this.client.sftp((err, sftp) => {
                if (err) {
                    reject(new Error(`Failed to initialize SFTP: ${err.message}`));
                } else {
                    resolve(sftp);
                }
            });
        });
    }
}

/**
 * Check if SSH transfer mode is configured and has required fields
 */
export function isSSHTransferEnabled(config: MSSQLConfig): boolean {
    return config.fileTransferMode === "ssh" && !!config.sshUsername;
}
