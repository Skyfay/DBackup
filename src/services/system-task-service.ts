import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { DatabaseAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { healthCheckService } from "./healthcheck-service";
import { auditService } from "./audit-service";

// Ensure adapters are registered for worker context
registerAdapters();

export const SYSTEM_TASKS = {
    UPDATE_DB_VERSIONS: "system.update_db_versions",
    HEALTH_CHECK: "system.health_check",
    CLEAN_OLD_LOGS: "system.clean_audit_logs"
};

export const DEFAULT_TASK_CONFIG = {
    [SYSTEM_TASKS.UPDATE_DB_VERSIONS]: {
        interval: "0 * * * *", // Every hour
        label: "Update Database Versions",
        description: "Checks connectivity and fetches version information from all configured database sources."
    },
    [SYSTEM_TASKS.HEALTH_CHECK]: {
        interval: "*/1 * * * *", // Every minute
        label: "Health Check & Connectivity",
        description: "Periodically pings all configured database and storage adapters to track availability and latency."
    },
    [SYSTEM_TASKS.CLEAN_OLD_LOGS]: {
        interval: "0 0 * * *", // Daily at midnight
        label: "Clean Old Logs",
        description: "Removes audit logs older than the configured retention period (default: 90 days) to prevent disk filling."
    }
};

export class SystemTaskService {

    async getTaskConfig(taskId: string) {
        const key = `task.${taskId}.schedule`;
        const setting = await prisma.systemSetting.findUnique({ where: { key } });
        return setting?.value || DEFAULT_TASK_CONFIG[taskId as keyof typeof DEFAULT_TASK_CONFIG]?.interval;
    }

    async setTaskConfig(taskId: string, schedule: string) {
        const key = `task.${taskId}.schedule`;
        await prisma.systemSetting.upsert({
            where: { key },
            update: { value: schedule },
            create: { key, value: schedule, description: `Schedule for ${taskId}` }
        });
    }

    async runTask(taskId: string) {
        console.log(`[SystemTask] Running ${taskId}...`);

        switch (taskId) {
            case SYSTEM_TASKS.UPDATE_DB_VERSIONS:
                await this.runUpdateDbVersions();
                break;
            case SYSTEM_TASKS.HEALTH_CHECK:
                await healthCheckService.performHealthCheck();
                break;
            case SYSTEM_TASKS.CLEAN_OLD_LOGS:
                await this.runCleanOldLogs();
                break;
            default:
                console.warn(`[SystemTask] Unknown task: ${taskId}`);
        }
    }

    private async runCleanOldLogs() {
        try {
            // Check if there is a configured retention period
            const retentionKey = "audit.retentionDays";
            const setting = await prisma.systemSetting.findUnique({ where: { key: retentionKey } });
            const retentionDays = setting ? parseInt(setting.value) : 90; // Default 90 days

            console.log(`[SystemTask] Cleaning audit logs older than ${retentionDays} days...`);
            const deleted = await auditService.cleanOldLogs(retentionDays);
            console.log(`[SystemTask] Deleted ${deleted.count} old audit logs.`);
        } catch (error: any) {
            console.error(`[SystemTask] Failed to clean audit logs: ${error.message}`);
        }
    }

    private async runUpdateDbVersions() {
        const sources = await prisma.adapterConfig.findMany({
            where: { type: 'database' }
        });

        for (const source of sources) {
            try {
                const adapter = registry.get(source.adapterId) as DatabaseAdapter;
                if (!adapter) {
                    console.warn(`[SystemTask] Adapter implementation not found: ${source.adapterId}`);
                    continue;
                }
                if (!adapter.test) {
                    console.log(`[SystemTask] Adapter ${source.adapterId} does not support test/version check.`);
                    continue;
                }

                // Decrypt config
                let config;
                try {
                    config = decryptConfig(JSON.parse(source.config));
                } catch(e: any) {
                    console.error(`[SystemTask] Config decrypt failed for ${source.name}: ${e.message}`);
                    continue;
                }

                console.log(`[SystemTask] Testing connection for ${source.name} (${source.adapterId})...`);
                const result = await adapter.test(config);
                console.log(`[SystemTask] Result for ${source.name}: success=${result.success} version=${result.version}`);

                if (result.success && result.version) {
                    // Update Metadata
                    const currentMeta = source.metadata ? JSON.parse(source.metadata) : {};
                    const newMeta = {
                        ...currentMeta,
                        engineVersion: result.version,
                        lastCheck: new Date().toISOString(),
                        status: 'Online'
                    };

                    await prisma.adapterConfig.update({
                        where: { id: source.id },
                        data: { metadata: JSON.stringify(newMeta) }
                    });
                    console.log(`[SystemTask] Updated version for ${source.name}: ${result.version}`);
                } else {
                    // Mark as offline or warning?
                     const currentMeta = source.metadata ? JSON.parse(source.metadata) : {};
                     const newMeta = {
                        ...currentMeta,
                        status: 'Unreachable',
                        lastError: result.message
                     };
                     await prisma.adapterConfig.update({
                        where: { id: source.id },
                        data: { metadata: JSON.stringify(newMeta) }
                    });
                }

            } catch (e: any) {
                console.error(`[SystemTask] Failed check for ${source.name}:`, e);
            }
        }
    }
}

export const systemTaskService = new SystemTaskService();
