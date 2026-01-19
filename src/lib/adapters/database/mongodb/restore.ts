import { BackupResult } from "@/lib/core/interfaces";
import { execFileAsync } from "./connection";
import { getDialect } from "./dialects";
import { spawn } from "child_process";
import { createReadStream } from "fs";
import { waitForProcess } from "@/lib/adapters/process";

export async function prepareRestore(config: any, databases: string[]): Promise<void> {
    // Determine credentials (privileged or standard)
    const usageConfig = { ...config };
    if (config.privilegedAuth) {
        usageConfig.user = config.privilegedAuth.user;
        usageConfig.password = config.privilegedAuth.password;
    }

    const dialect = getDialect('mongodb', config.detectedVersion);
    // getConnectionArgs returns generic host/port/auth args suitable for tools like mongosh
    const args = dialect.getConnectionArgs(usageConfig);

    // Check if --quiet is needed or already in args
    if (!args.includes('--quiet')) args.unshift('--quiet');

    for (const dbName of databases) {
            // Permission check script
            const evalScript = `
            try {
                var target = db.getSiblingDB('${dbName.replace(/'/g, "\\'")}');
                target.createCollection('__perm_check_tmp');
                target.getCollection('__perm_check_tmp').drop();
            } catch(e) {
                print('ERROR: ' + e.message);
                quit(1);
            }
            `;

            try {
                // We use mongosh for eval execution
                await execFileAsync('mongosh', [...args, '--eval', evalScript]);
            } catch(e: any) {
                const msg = e.stdout || e.stderr || e.message || "";
                if (msg.includes("not authorized") || msg.includes("Authorization") || msg.includes("requires authentication") || msg.includes("command create requires")) {
                    throw new Error(`Access denied to database '${dbName}'. Permissions?`);
                }
                throw e;
            }
    }
}

export async function restore(config: any, sourcePath: string, onLog?: (msg: string) => void): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];

    const log = (msg: string) => {
        logs.push(msg);
        if (onLog) onLog(msg);
    };

    try {
        const dialect = getDialect('mongodb', config.detectedVersion);
        const args = dialect.getRestoreArgs(config);

        // Masking for logs
        const logArgs = args.map(arg => {
            if(arg.startsWith('--password')) return '--password=******';
            if(arg.startsWith('mongodb')) return 'mongodb://...';
            return arg;
        });

        log(`Starting restore with args: mongorestore ${logArgs.join(' ')}`);

        // Spawn process
        const restoreProcess = spawn('mongorestore', args);
        const readStream = createReadStream(sourcePath);

        readStream.pipe(restoreProcess.stdin);

        restoreProcess.stderr.on('data', (data) => {
             log(`[mongorestore] ${data.toString()}`);
        });

        // Handle stream errors
        readStream.on('error', (err) => {
            log(`Read stream error: ${err.message}`);
            restoreProcess.kill();
        });

        await waitForProcess(restoreProcess, 'mongorestore');

        return {
            success: true,
            logs,
            startedAt,
            completedAt: new Date(),
        };

    } catch (error: any) {
        log(`Restore failed: ${error.message}`);
        return {
            success: false,
            logs,
            error: error.message,
            startedAt,
            completedAt: new Date(),
        };
    }
}
