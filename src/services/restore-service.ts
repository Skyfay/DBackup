import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { StorageAdapter, DatabaseAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import path from "path";
import os from "os";
import fs from "fs";

// Ensure adapters are loaded
registerAdapters();

export interface RestoreInput {
    storageConfigId: string;
    file: string;
    targetSourceId: string;
    targetDatabaseName?: string;
    databaseMapping?: Record<string, string>;
    privilegedAuth?: {
        username?: string;
        password?: string;
    };
}

export class RestoreService {
    async restore(input: RestoreInput) {
        const { file } = input;

        // Start Logging Execution
        const execution = await prisma.execution.create({
            data: {
                type: 'Restore',
                status: 'Running',
                logs: JSON.stringify([`Starting restore for ${file}`]),
                startedAt: new Date(),
                path: file
            }
        });
        const executionId = execution.id;

        // Run in background (do not await)
        this.runRestoreProcess(executionId, input).catch(err => {
            console.error(`Background restore failed for ${executionId}:`, err);
        });

        return { success: true, executionId, message: "Restore started" };
    }

    private async runRestoreProcess(executionId: string, input: RestoreInput) {
        const { storageConfigId, file, targetSourceId, targetDatabaseName, databaseMapping, privilegedAuth } = input;
        let tempFile: string | null = null;

        // Log Buffer
        let internalLogs: string[] = [`Starting restore for ${file}`];
        let lastLogUpdate = Date.now();
        let currentProgress = 0;

        const flushLogs = async (force = false) => {
            const now = Date.now();
            if (force || now - lastLogUpdate > 2000) { // Update every 2 seconds max
                await prisma.execution.update({
                    where: { id: executionId },
                    data: {
                        logs: JSON.stringify(internalLogs),
                        metadata: JSON.stringify({ progress: currentProgress })
                    }
                }).catch(() => {});
                lastLogUpdate = now;
            }
        };

        const log = (msg: string) => {
            internalLogs.push(msg);
            flushLogs(); // Throttled
        };

        const updateProgress = (p: number) => {
             currentProgress = p;
             flushLogs();
        };

        try {
            if (!file || !targetSourceId) {
                throw new Error("Missing file or targetSourceId");
            }

            log(`Initiating restore process...`);

            // 1. Get Storage Adapter
            const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: storageConfigId } });
            if (!storageConfig || storageConfig.type !== "storage") {
                throw new Error("Storage adapter not found");
            }

            const storageAdapter = registry.get(storageConfig.adapterId) as StorageAdapter;
            if (!storageAdapter) {
                throw new Error("Storage impl missing");
            }

            // 2. Get Source Adapter
            const sourceConfig = await prisma.adapterConfig.findUnique({ where: { id: targetSourceId } });
            if (!sourceConfig || sourceConfig.type !== "database") {
                throw new Error("Source adapter not found");
            }

            const sourceAdapter = registry.get(sourceConfig.adapterId) as DatabaseAdapter;
            if (!sourceAdapter) {
                throw new Error("Source impl missing");
            }

            // 3. Download File
            log(`Downloading backup file: ${file}...`);
            const tempDir = os.tmpdir();
            tempFile = path.join(tempDir, path.basename(file));

            const sConf = decryptConfig(JSON.parse(storageConfig.config));
            const downloadSuccess = await storageAdapter.download(sConf, file, tempFile);

            if (!downloadSuccess) {
                throw new Error("Failed to download file from storage");
            }
            log(`Download complete.`);

            // 4. Restore
            log(`Starting database restore on ${sourceConfig.name}...`);
            const dbConf = decryptConfig(JSON.parse(sourceConfig.config));

            // Override database name if provided
            if (targetDatabaseName) {
                dbConf.database = targetDatabaseName;
            }

            // Pass database mapping if provided
            if (databaseMapping) {
                dbConf.databaseMapping = databaseMapping;
            }

            // Add privileged auth if provided
            if (privilegedAuth) {
                dbConf.privilegedAuth = privilegedAuth;
            }

            const restoreResult = await sourceAdapter.restore(dbConf, tempFile, (msg) => {
                log(msg); // Live logs from adapter
            }, (p) => {
                updateProgress(p); // Progress updates
            });

            if (!restoreResult.success) {
                // Final update
                internalLogs = restoreResult.logs; // Sync final logs
                await prisma.execution.update({
                    where: { id: executionId },
                    data: {
                        status: 'Failed',
                        endedAt: new Date(),
                        logs: JSON.stringify(internalLogs)
                    }
                });
            } else {
                internalLogs = restoreResult.logs;
                log(`Restore completed successfully.`);
                await prisma.execution.update({
                    where: { id: executionId },
                    data: {
                        status: 'Success',
                        endedAt: new Date(),
                        logs: JSON.stringify(internalLogs)
                    }
                });
            }

        } catch (error: any) {
            console.error("Restore service error:", error);
            log(`Fatal Error: ${error.message}`);
            await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify(internalLogs) }
            });
        } finally {
            if (tempFile && fs.existsSync(tempFile)) {
                try { fs.unlinkSync(tempFile); } catch {}
            }
        }
    }
}

export const restoreService = new RestoreService();
