import { DatabaseAdapter } from "@/lib/core/interfaces";
import { spawn } from "child_process";
import fs from "fs";
import { SshClient } from "./ssh-client";

export const dump: DatabaseAdapter["dump"] = async (config, destinationPath, onLog, onProgress) => {
    const startedAt = new Date();
    const mode = config.mode || "local";
    const logs: string[] = [];

    const log = (msg: string) => {
        logs.push(msg);
        if (onLog) onLog(msg);
    };

    try {
        log(`Starting SQLite dump in ${mode} mode...`);

        if (mode === "local") {
            return await dumpLocal(config, destinationPath, log, onProgress).then(res => ({
                ...res,
                startedAt,
                completedAt: new Date(),
                logs
            }));
        } else if (mode === "ssh") {
            return await dumpSsh(config, destinationPath, log, onProgress).then(res => ({
                ...res,
                startedAt,
                completedAt: new Date(),
                logs
            }));
        } else {
            throw new Error(`Invalid mode: ${mode}`);
        }

    } catch (error: any) {
        log(`Error during dump: ${error.message}`);
        return {
            success: false,
            error: error.message,
            logs,
            startedAt,
            completedAt: new Date()
        };
    }
};

async function dumpLocal(config: any, destinationPath: string, log: (msg: string) => void, _onProgress?: (percent: number) => void): Promise<any> {
    const binaryPath = config.sqliteBinaryPath || "sqlite3";
    const dbPath = config.path;
    const writeStream = fs.createWriteStream(destinationPath);

    log(`Executing: ${binaryPath} "${dbPath}" .dump`);

    return new Promise((resolve, reject) => {
        const child = spawn(binaryPath, [dbPath, ".dump"]);

        child.stdout.pipe(writeStream);

        child.stderr.on("data", (data) => {
            log(`[SQLite Stderr]: ${data.toString()}`);
        });

        child.on("close", (code) => {
            if (code === 0) {
                log("Dump completed successfully.");
                fs.stat(destinationPath, (err, stats) => {
                    if (err) resolve({ success: true }); // Should not happen usually
                    else resolve({ success: true, size: stats.size, path: destinationPath });
                });
            } else {
                reject(new Error(`SQLite dump process failed with code ${code}`));
            }
        });

        child.on("error", (err) => {
            reject(err);
        });
    });
}

async function dumpSsh(config: any, destinationPath: string, log: (msg: string) => void, _onProgress?: (percent: number) => void): Promise<any> {
    const client = new SshClient();
    const writeStream = fs.createWriteStream(destinationPath);
    const binaryPath = config.sqliteBinaryPath || "sqlite3";
    const dbPath = config.path;

    await client.connect(config);
    log("SSH connection established.");

    return new Promise((resolve, reject) => {
        const command = `${binaryPath} "${dbPath}" .dump`;
        log(`Executing remote command: ${command}`);

        client.execStream(command, (err, stream) => {
            if (err) {
                client.end();
                return reject(err);
            }

            stream.pipe(writeStream);

            stream.stderr.on("data", (data: any) => {
                log(`[Remote Stderr]: ${data.toString()}`);
            });

            stream.on("close", (code: number, _signal: any) => {
                client.end();
                if (code === 0) {
                     log("Remote dump completed successfully.");
                     fs.stat(destinationPath, (err, stats) => {
                         if (err) resolve({ success: true });
                         else resolve({ success: true, size: stats.size, path: destinationPath });
                     });
                } else {
                    reject(new Error(`Remote process exited with code ${code}`));
                }
            });
        });
    });
}
