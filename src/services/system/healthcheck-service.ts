import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import { notify, getNotificationConfig } from "@/services/notifications/system-notification-service";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";

const log = logger.child({ service: "HealthCheckService" });

// Timeout for individual adapter health checks (15 seconds)
const ADAPTER_CHECK_TIMEOUT_MS = 15_000;
// Maximum number of concurrent health checks
const MAX_CONCURRENT_CHECKS = 5;
// Default cooldown between repeated offline notifications (24 hours)
const DEFAULT_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// SystemSetting key for offline notification state
const OFFLINE_STATE_KEY = "healthcheck.offline.state";

/** Per-adapter offline notification state */
interface OfflineNotificationState {
  /** Whether an offline notification has been sent and the adapter is still offline */
  active: boolean;
  /** ISO timestamp of the last notification sent */
  lastNotifiedAt: string | null;
}

/** Map of adapter config ID → notification state */
type OfflineStateMap = Record<string, OfflineNotificationState>;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Health check timed out after ${ms}ms for ${label}`)), ms);
        promise.then(
            (val) => { clearTimeout(timer); resolve(val); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

async function loadOfflineStates(): Promise<OfflineStateMap> {
    const row = await prisma.systemSetting.findUnique({ where: { key: OFFLINE_STATE_KEY } });
    if (!row) return {};
    try {
        return JSON.parse(row.value) as OfflineStateMap;
    } catch {
        return {};
    }
}

async function saveOfflineStates(states: OfflineStateMap): Promise<void> {
    await prisma.systemSetting.upsert({
        where: { key: OFFLINE_STATE_KEY },
        update: { value: JSON.stringify(states) },
        create: {
            key: OFFLINE_STATE_KEY,
            value: JSON.stringify(states),
            description: "Health check offline notification state tracking",
        },
    });
}

function shouldNotifyOffline(state: OfflineNotificationState | undefined, cooldownMs: number): boolean {
    if (!state || !state.active) return true;
    if (!state.lastNotifiedAt) return true;
    if (cooldownMs === 0) return false;
    return Date.now() - new Date(state.lastNotifiedAt).getTime() >= cooldownMs;
}

export class HealthCheckService {
    async performHealthCheck() {
        log.debug("Starting health check cycle");
        const configs = await prisma.adapterConfig.findMany({
            where: {
                OR: [
                    { type: 'database' },
                    { type: 'storage' }
                ]
            }
        });

        // Load offline notification state and reminder cooldown
        const offlineStates = await loadOfflineStates();
        let reminderCooldownMs = DEFAULT_REMINDER_COOLDOWN_MS;
        try {
            const notifConfig = await getNotificationConfig();
            const eventCfg = notifConfig.events[NOTIFICATION_EVENTS.CONNECTION_OFFLINE];
            if (eventCfg?.reminderIntervalHours !== undefined && eventCfg.reminderIntervalHours !== null) {
                reminderCooldownMs = eventCfg.reminderIntervalHours * 60 * 60 * 1000;
            }
        } catch {
            // Fall back to default cooldown
        }

        let stateChanged = false;

        // Run checks in parallel batches to avoid blocking the event loop serially
        for (let i = 0; i < configs.length; i += MAX_CONCURRENT_CHECKS) {
            const batch = configs.slice(i, i + MAX_CONCURRENT_CHECKS);
            const results = await Promise.allSettled(
                batch.map(config => this.checkAdapter(config, offlineStates, reminderCooldownMs))
            );
            for (const result of results) {
                if (result.status === "fulfilled" && result.value) {
                    stateChanged = true;
                }
            }
        }

        // Persist offline states if anything changed
        if (stateChanged) {
            try {
                await saveOfflineStates(offlineStates);
            } catch (e) {
                log.error("Failed to save offline notification states", {}, wrapError(e));
            }
        }

        log.debug("Health check cycle completed");
    }

    /** Delete health check logs older than the given retention period (in days). */
    async cleanOldLogs(retentionDays: number) {
        const retentionDate = new Date();
        retentionDate.setDate(retentionDate.getDate() - retentionDays);

        const deleted = await prisma.healthCheckLog.deleteMany({
            where: {
                createdAt: {
                    lt: retentionDate
                }
            }
        });
        return deleted.count;
    }

    /**
     * Check a single adapter and return whether offline state changed.
     */
    private async checkAdapter(
        configRow: any,
        offlineStates: OfflineStateMap,
        reminderCooldownMs: number,
    ): Promise<boolean> {
        let latency = 0;
        let errorMsg: string | null = null;
        let success = false;

        try {
            const adapter = registry.get(configRow.adapterId);
            if (!adapter) {
                throw new Error(`Adapter ${configRow.adapterId} not found`);
            }

            const checkFn = adapter.ping ?? adapter.test;
            if (!checkFn) {
                // If ping/test not supported, we skip
                return false;
            }

             // Resolve adapter config (merges credential profile if present)
            let config;
            try {
                config = await resolveAdapterConfig(configRow);
            } catch(e: unknown) {
                throw new Error(`Config decrypt failed: ${getErrorMessage(e)}`);
            }

            const start = Date.now();
            const result = await withTimeout(
                checkFn.call(adapter, config),
                ADAPTER_CHECK_TIMEOUT_MS,
                configRow.name || configRow.id
            );
            const end = Date.now();
            latency = end - start;

            success = result.success;
            if (!success) {
                errorMsg = result.message;
            }

        } catch (e: unknown) {
            success = false;
            errorMsg = getErrorMessage(e);
        }

        // Status Logic
        let newStatus = 'ONLINE';
        const consecutiveFailures = success ? 0 : (configRow.consecutiveFailures + 1);

        if (!success) {
            if (consecutiveFailures >= 3) {
                newStatus = 'OFFLINE';
            } else {
                newStatus = 'DEGRADED';
            }
        }

        try {
            // Update DB
            await prisma.$transaction([
                prisma.healthCheckLog.create({
                    data: {
                        adapterConfigId: configRow.id,
                        status: newStatus as any,
                        latencyMs: latency,
                        error: errorMsg
                    }
                }),
                prisma.adapterConfig.update({
                    where: { id: configRow.id },
                    data: {
                        lastHealthCheck: new Date(),
                        lastStatus: newStatus as any,
                        consecutiveFailures: consecutiveFailures
                    }
                })
            ]);
        } catch (e) {
            log.error("Failed to update health check status", { configName: configRow.name }, wrapError(e));
        }

        // ── Offline Notification Logic ─────────────────────────
        let stateChanged = false;
        const currentState = offlineStates[configRow.id];

        // Skip notifications if explicitly disabled for this adapter
        const meta = configRow.metadata ? JSON.parse(configRow.metadata) : {};
        if (meta.healthNotificationsDisabled === true) {
            return stateChanged;
        }

        if (newStatus === "OFFLINE") {
            // Adapter just became or remains offline - check if we should notify
            if (shouldNotifyOffline(currentState, reminderCooldownMs)) {
                try {
                    await notify({
                        eventType: NOTIFICATION_EVENTS.CONNECTION_OFFLINE,
                        data: {
                            adapterName: configRow.name || configRow.id,
                            adapterType: configRow.type as "database" | "storage",
                            adapterId: configRow.adapterId,
                            consecutiveFailures,
                            lastError: errorMsg || undefined,
                            timestamp: new Date().toISOString(),
                        },
                    });
                } catch (e) {
                    log.error("Failed to send offline notification", { configName: configRow.name }, wrapError(e));
                }
                offlineStates[configRow.id] = { active: true, lastNotifiedAt: new Date().toISOString() };
                stateChanged = true;
            } else if (!currentState?.active) {
                offlineStates[configRow.id] = { active: true, lastNotifiedAt: currentState?.lastNotifiedAt ?? null };
                stateChanged = true;
            }
        } else if (currentState?.active) {
            // Adapter recovered - send recovery notification and reset state
            let downtime: string | undefined;
            if (currentState.lastNotifiedAt) {
                const ms = Date.now() - new Date(currentState.lastNotifiedAt).getTime();
                const hours = Math.floor(ms / (60 * 60 * 1000));
                const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
                downtime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            }
            try {
                await notify({
                    eventType: NOTIFICATION_EVENTS.CONNECTION_ONLINE,
                    data: {
                        adapterName: configRow.name || configRow.id,
                        adapterType: configRow.type as "database" | "storage",
                        adapterId: configRow.adapterId,
                        downtime,
                        timestamp: new Date().toISOString(),
                    },
                });
            } catch (e) {
                log.error("Failed to send recovery notification", { configName: configRow.name }, wrapError(e));
            }
            delete offlineStates[configRow.id];
            stateChanged = true;
        }

        return stateChanged;
    }
}

export const healthCheckService = new HealthCheckService();
