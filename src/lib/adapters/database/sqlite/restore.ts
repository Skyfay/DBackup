import { DatabaseAdapter } from "@/lib/core/interfaces";
import { spawn } from "child_process";
import fs from "fs";
import { SshClient } from "./ssh-client";

export const prepareRestore: DatabaseAdapter["prepareRestore"] = async (_config, _databases) => {
     // No major prep needed for SQLite mostly, but could check write permissions here
};

export const restore: DatabaseAdapter["restore"] = async (config, sourcePath, onLog, onProgress) => {
    const startedAt = new Date();
    const mode = config.mode || "local";
    const logs: string[] = [];

    const log = (msg: string) => {
        logs.push(msg);
        if (onLog) onLog(msg);
    };

    try {
        log(`Starting SQLite restore in ${mode} mode...`);

        if (mode === "local") {
            return await restoreLocal(config, sourcePath, log, onProgress).then(res => ({
                ...res,
                startedAt,
                completedAt: new Date(),
                logs
            }));
        } else if (mode === "ssh") {
            return await restoreSsh(config, sourcePath, log, onProgress).then(res => ({
                ...res,
                startedAt,
                completedAt: new Date(),
                logs
            }));
        } else {
            throw new Error(`Invalid mode: ${mode}`);
        }

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Error during restore: ${message}`);
        return {
            success: false,
            error: message,
            logs,
            startedAt,
            completedAt: new Date()
        };
    }
};

async function restoreLocal(config: any, sourcePath: string, log: (msg: string) => void, onProgress?: (percent: number) => void): Promise<any> {
    const binaryPath = config.sqliteBinaryPath || "sqlite3";
    const dbPath = config.path;

    // Safety backup
    if (fs.existsSync(dbPath)) {
        const backupPath = `${dbPath}.bak-${Date.now()}`;
        log(`Backing up existing database to ${backupPath}`);
        fs.copyFileSync(dbPath, backupPath);

        log(`Removing existing database file before restore...`);
        fs.unlinkSync(dbPath);
    }

    log(`Executing: ${binaryPath} "${dbPath}" < ${sourcePath}`);

    // Setup generic read stream with progress
    const totalSize = (await fs.promises.stat(sourcePath)).size;
    let processed = 0;
    const readStream = fs.createReadStream(sourcePath);

    if (onProgress) {
        readStream.on('data', (chunk) => {
            processed += chunk.length;
            const percent = Math.round((processed / totalSize) * 100);
            onProgress(percent);
        });
    }

    return new Promise((resolve, reject) => {
        const child = spawn(binaryPath, [dbPath]);

        readStream.pipe(child.stdin);

        child.stderr.on("data", (data) => {
             // Ignore "locked" errors if possible, or log them
            log(`[SQLite Stderr]: ${data.toString()}`);
        });

        child.on("close", (code) => {
            if (code === 0) {
                log("Restore completed successfully.");
                resolve({ success: true });
            } else {
                reject(new Error(`SQLite restore process failed with code ${code}`));
            }
        });

        child.on("error", (err) => {
            reject(err);
        });
    });
}

async function restoreSsh(config: any, sourcePath: string, log: (msg: string) => void, onProgress?: (percent: number) => void): Promise<any> {
    const client = new SshClient();
    const binaryPath = config.sqliteBinaryPath || "sqlite3";
    const dbPath = config.path;

    await client.connect(config);
    log("SSH connection established.");

    // Create remote backup and delete original
    log("Creating remote backup of existing DB and cleaning up...");
    const backupCmd = `if [ -f "${dbPath}" ]; then cp "${dbPath}" "${dbPath}.bak-$(date +%s)"; rm "${dbPath}"; echo "Backed up and removed old DB"; else echo "No existing DB"; fi`;
    await client.exec(backupCmd);

    return new Promise(async (resolve, reject) => {
        const command = `${binaryPath} "${dbPath}"`;
        log(`Executing remote command: ${command}`);

        client.execStream(command, async (err, stream) => {
            if (err) {
                client.end();
                return reject(err);
            }

            // Setup generic read stream with progress
             const totalSize = (await fs.promises.stat(sourcePath)).size;
             let processed = 0;
             const readStream = fs.createReadStream(sourcePath);

             if (onProgress) {
                 readStream.on('data', (chunk) => {
                     processed += chunk.length;
                     const percent = Math.round((processed / totalSize) * 100);
                     onProgress(percent);
                 });
             }

            readStream.pipe(stream.stdin);

            stream.stderr.on("data", (data: any) => {
                log(`[Remote Stderr]: ${data.toString()}`);
            });

            stream.on("close", (code: number, _signal: any) => {
                client.end();
                if (code === 0) {
                     log("Remote restore completed successfully.");
                     resolve({ success: true });
                } else {
                    reject(new Error(`Remote process exited with code ${code}`));
                }
            });
        });
    });
}


