/**
 * What the system tasks do when they run. Each returns an outcome with a short result for the
 * Settings page, like "v3.4.0 is current", and whether something needs a look.
 */

import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { registry } from "@/lib/core/registry";
import { runAdapterTest } from "@/lib/transport/adapter-invoke";
import { DatabaseAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { updateService } from "./update-service";
import { notify, getNotificationConfig } from "@/services/notifications/system-notification-service";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";
import { getEventDefinition } from "@/lib/notifications/events";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { getErrorMessage, wrapError } from "@/lib/logging/errors";
import { recordVersionIfChanged } from "./db-version-service";
import { databaseListService } from "@/services/databases/database-list-service";
import type { IntegrityCopy } from "@/services/backup/integrity-service";

const log = logger.child({ service: "SystemTaskService" });

// Timeout for individual adapter connection tests (15 seconds)
const ADAPTER_TEST_TIMEOUT_MS = 15_000;

/** How a run of a task went, for the Last run column of the Settings page. */
export interface TaskOutcome {
    /** A few words on what it did, like "2,418 removed". Null shows how long it took instead. */
    summary?: string | null;
    /** False when something needs a look. */
    ok?: boolean;
    /** The run in History, for a task that writes one. */
    executionId?: string;
    /** The task goes on in the background and records its outcome itself when it ends. */
    pending?: boolean;
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
/** "v3.4.0", whether the tag had its v or not. */
const version = (value: string) => `v${value.replace(/^v/, "")}`;

export async function checkForUpdates(): Promise<TaskOutcome> {
    log.debug("Checking for updates");
    try {
        // The check answers "current" while it is off, which a run by hand must not claim.
        const setting = await prisma.systemSetting.findUnique({ where: { key: "general.checkForUpdates" } });
        if (setting?.value === "false") return { summary: "Look for new versions is off" };


        const result = await updateService.checkForUpdates();

        if (result.updateAvailable) {
            log.info("New version available", {
                latestVersion: result.latestVersion,
                currentVersion: result.currentVersion
            });

            // Send notification with deduplication
            await notifyUpdateAvailable(result.latestVersion, result.currentVersion);
            return { summary: `${version(result.latestVersion)} is out` };
        }

        log.debug("Application is up to date", { currentVersion: result.currentVersion });

        // Reset notification state when no longer outdated
        await resetUpdateNotificationState();
        return { summary: `${version(result.currentVersion)} is current` };
    } catch (error: unknown) {
        log.error("Update check failed", {}, wrapError(error));
        return { ok: false, summary: getErrorMessage(error) };
    }
}

/**
 * Send update notification with deduplication.
 * - Sends immediately when a new version is first detected
 * - Re-sends after the configured reminder interval (or default 7 days) while still outdated
 * - Does NOT re-send if the same version was already notified within the interval
 */
async function notifyUpdateAvailable(latestVersion: string, currentVersion: string) {
    const STATE_KEY = "update.notification.state";

    try {
        // Load existing state
        const row = await prisma.systemSetting.findUnique({ where: { key: STATE_KEY } });
        const state: { lastNotifiedVersion: string | null; lastNotifiedAt: string | null } =
            row ? JSON.parse(row.value) : { lastNotifiedVersion: null, lastNotifiedAt: null };

        // Determine reminder interval from notification config
        const config = await getNotificationConfig();
        const eventConfig = config.events[NOTIFICATION_EVENTS.UPDATE_AVAILABLE];
        const eventDef = getEventDefinition(NOTIFICATION_EVENTS.UPDATE_AVAILABLE);

        // The default of the event, 7 days, which the Notifications part names too.
        const DEFAULT_REMINDER_HOURS = eventDef?.defaultReminderHours ?? 168;
        let reminderMs = DEFAULT_REMINDER_HOURS * 60 * 60 * 1000;
        let reminderDisabled = false;

        if (eventDef?.supportsReminder && eventConfig?.reminderIntervalHours !== undefined && eventConfig.reminderIntervalHours !== null) {
            if (eventConfig.reminderIntervalHours === 0) {
                reminderDisabled = true;
            } else {
                reminderMs = eventConfig.reminderIntervalHours * 60 * 60 * 1000;
            }
        }

        // Decide if we should notify
        const isNewVersion = state.lastNotifiedVersion !== latestVersion;
        const cooldownElapsed = !reminderDisabled && (!state.lastNotifiedAt ||
            (Date.now() - new Date(state.lastNotifiedAt).getTime() >= reminderMs));

        if (!isNewVersion && !cooldownElapsed) {
            log.debug("Skipping update notification (already notified, cooldown active)", {
                lastNotifiedVersion: state.lastNotifiedVersion,
                lastNotifiedAt: state.lastNotifiedAt,
            });
            return;
        }

        // Dispatch notification
        await notify({
            eventType: NOTIFICATION_EVENTS.UPDATE_AVAILABLE,
            data: {
                latestVersion,
                currentVersion,
                releaseUrl: "https://github.com/Skyfay/DBackup/releases",
                timestamp: new Date().toISOString(),
            },
        });

        // Update state
        const newState = {
            lastNotifiedVersion: latestVersion,
            lastNotifiedAt: new Date().toISOString(),
        };
        await prisma.systemSetting.upsert({
            where: { key: STATE_KEY },
            update: { value: JSON.stringify(newState) },
            create: {
                key: STATE_KEY,
                value: JSON.stringify(newState),
                description: "Update notification deduplication state",
            },
        });

        log.info("Update notification sent", { latestVersion, isNewVersion });
    } catch (error: unknown) {
        log.error("Failed to send update notification", {}, wrapError(error));
    }
}

/** Reset update notification state when the app is up to date (allows re-notification for future updates) */
async function resetUpdateNotificationState() {
    const STATE_KEY = "update.notification.state";
    try {
        await prisma.systemSetting.deleteMany({ where: { key: STATE_KEY } });
    } catch {
        // Ignore - state might not exist
    }
}

export async function updateDbVersions(): Promise<TaskOutcome> {
    const sources = await prisma.adapterConfig.findMany({
        where: { type: 'database' }
    });
    let answered = 0;
    let tested = 0;

    for (const source of sources) {
        try {
            const adapter = registry.get(source.adapterId) as DatabaseAdapter;
            if (!adapter) {
                log.warn("Adapter implementation not found", { adapterId: source.adapterId });
                continue;
            }
            if (!adapter.test) {
                log.debug("Adapter does not support test/version check", { adapterId: source.adapterId });
                continue;
            }

            // Resolve config (merges credential profile if present)
            let config;
            try {
                config = await resolveAdapterConfig(source);
            } catch(e: unknown) {
                log.error("Config decrypt failed", { sourceName: source.name }, wrapError(e));
                continue;
            }

            log.debug("Testing connection", { sourceName: source.name, adapterId: source.adapterId });
            tested++;
            const result = (await runAdapterTest(adapter, config, {
                timeoutMs: ADAPTER_TEST_TIMEOUT_MS,
                label: source.name,
            }))!;
            log.debug("Connection test result", { sourceName: source.name, success: result.success, version: result.version });

            if (result.success && result.version) {
                answered++;
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
                log.info("Updated database version", { sourceName: source.name, version: result.version });

                // Record version-history entry only when the detected version differs
                // from the last stored entry. Dispatches a notification on change.
                try {
                    // The MSSQL adapter additionally returns `edition` even though it's not
                    // declared on the shared interface.
                    const edition = (result as { edition?: string }).edition;
                    const change = await recordVersionIfChanged(source.id, result.version, edition);
                    if (change.changed && change.previousVersion !== null) {
                        // Skip notification for the very first recorded entry per source
                        // (previousVersion === null) - that's just the baseline.
                        await notify({
                            eventType: NOTIFICATION_EVENTS.DB_VERSION_CHANGED,
                            data: {
                                sourceName: source.name,
                                sourceId: source.id,
                                adapterId: source.adapterId,
                                previousVersion: change.previousVersion,
                                newVersion: change.newVersion,
                                edition,
                                timestamp: new Date().toISOString(),
                                isDowngrade: change.isDowngrade,
                            },
                        });
                    }
                } catch (e: unknown) {
                    log.error("Failed to record/notify version change", { sourceName: source.name }, wrapError(e));
                }
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

        } catch (e: unknown) {
            log.error("Failed health check for source", { sourceName: source.name }, wrapError(e));
        }
    }

    // The databases of every source for the Database Explorer, after the versions so a slow
    // server does not hold those back. A failed read keeps the list from before.
    await databaseListService.readSources();

    if (tested === 0) return { summary: "No sources to read" };
    return { summary: `${answered} of ${plural(tested, "source", "sources")} answered`, ok: answered === tested };
}

export async function warmupStorageCache(): Promise<TaskOutcome> {
    const adapters = await prisma.adapterConfig.findMany({
        where: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
        select: { id: true, name: true },
    });
    log.info("Pre-warming storage cache", { count: adapters.length });
    const { storageService } = await import("@/services/storage/storage-service");
    let failed = 0;
    for (const adapter of adapters) {
        try {
            // If a cache row already exists: reconcile against remote to detect external changes.
            // If no cache row: do a full fetch to populate it.
            const cached = await prisma.storageListCache.findUnique({ where: { adapterConfigId: adapter.id } });
            if (cached) {
                await storageService.reconcileStorageListCache(adapter.id);
                log.debug("Reconciled storage cache", { adapterId: adapter.id, name: adapter.name });
            } else {
                await storageService.listFilesWithMetadata(adapter.id);
                log.debug("Warmed storage cache", { adapterId: adapter.id, name: adapter.name });
            }
        } catch (e: unknown) {
            failed++;
            log.warn("Failed to warm/reconcile cache for adapter", { adapterId: adapter.id, name: adapter.name }, wrapError(e));
        }
    }
    if (failed > 0) return { ok: false, summary: `${failed} of ${plural(adapters.length, "destination", "destinations")} failed` };
    return { summary: plural(adapters.length, "destination", "destinations") };
}

export async function syncPermissions(): Promise<TaskOutcome> {
    try {
        log.debug("Syncing permissions for SuperAdmin group");

        // Flatten all permissions from the source of truth
        const allPerms = Object.values(PERMISSIONS).flatMap(group => Object.values(group));

        // Update SuperAdmin group(s)
        // Using updateMany to handle case if multiple groups somehow have this name (though name is unique in schema)
        const result = await prisma.group.updateMany({
            where: { name: "SuperAdmin" },
            data: { permissions: JSON.stringify(allPerms) }
        });

        if (result.count > 0) {
            log.info("Updated permissions for SuperAdmin groups", { count: result.count });
            return { summary: `${allPerms.length} permissions` };
        }
        log.debug("No SuperAdmin group found, skipping permission sync");
        return { ok: false, summary: "No SuperAdmin group" };
    } catch (error: unknown) {
        log.error("Failed to sync permissions", {}, wrapError(error));
        return { ok: false, summary: getErrorMessage(error) };
    }
}

/**
 * Starts the integrity check in the background and hands back its run at once. `onDone` gets
 * the outcome when the check ends.
 */
export async function startIntegrityCheck(
    triggerType: "Manual" | "Scheduler" | "Api" | undefined,
    triggerLabel: string | undefined,
    onDone: (outcome: TaskOutcome) => Promise<void>
): Promise<TaskOutcome> {
    const { integrityService } = await import("@/services/backup/integrity-service");
    const { SystemTaskRunner } = await import("@/lib/runner/system-task-runner");
    const { INTEGRITY_CHECK_STAGES } = await import("@/lib/core/logs");

    const runner = await SystemTaskRunner.create(
        "IntegrityCheck",
        triggerType ?? "Scheduler",
        triggerLabel ?? "Scheduler"
    );

    // Every copy it checked, kept in the metadata for the page of the run. The one it
    // checks now is the last entry, and each copy is written once, however often it changes.
    const copies: Omit<IntegrityCopy, "index">[] = [];

    // Run async without blocking so callers receive the executionId immediately.
    (async () => {
        let outcome: TaskOutcome;
        try {
            await runner.start();
            const result = await integrityService.runFullIntegrityCheck({
                onLog: (msg, level, details) => runner.logEntry(msg, level ?? "info", "general", details),
                onStage: (stage) => runner.setStage(stage),
                onFileProgress: (done, total) => {
                    if (total > 0) runner.updateStageProgress((done / total) * 100);
                },
                onPlan: (plan) => runner.setExtra({ plan }),
                onCopy: ({ index, ...copy }) => {
                    copies[index] = copy;
                    runner.setExtra({ copies });
                },
            });
            runner.setStage(INTEGRITY_CHECK_STAGES.COMPLETED);
            runner.logEntry(
                `${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped of ${result.totalFiles} total${result.scanFailed > 0 ? `, ${result.scanFailed} destination${result.scanFailed !== 1 ? "s" : ""} unreachable` : ""}`,
                result.failed > 0 || result.scanFailed > 0 ? "warning" : "success"
            );
            await runner.finish(result.failed > 0 || result.scanFailed > 0 ? "Partial" : "Success");
            log.info("Integrity check completed", {
                total: result.totalFiles,
                passed: result.passed,
                failed: result.failed,
                skipped: result.skipped,
            });
            if (result.failed > 0) {
                await notify({
                    eventType: NOTIFICATION_EVENTS.INTEGRITY_CHECK_FAILURE,
                    data: {
                        totalFiles: result.totalFiles,
                        failed: result.failed,
                        passed: result.passed,
                        skipped: result.skipped,
                        triggerType: triggerType ?? "Scheduler",
                        errors: result.errors,
                    },
                }, { executionId: runner.id });
            }
            const checked = result.passed + result.failed;
            outcome = result.failed > 0
                ? { ok: false, summary: `${result.failed} of ${checked.toLocaleString("en-US")} failed` }
                : result.scanFailed > 0
                    ? { ok: false, summary: `${plural(result.scanFailed, "destination", "destinations")} unreachable` }
                    : { summary: `${plural(checked, "backup", "backups")} passed` };
        } catch (e: unknown) {
            runner.logEntry(getErrorMessage(e), "error");
            runner.setStage(INTEGRITY_CHECK_STAGES.FAILED);
            await runner.finish("Failed");
            log.error("Integrity check failed", {}, wrapError(e));
            outcome = { ok: false, summary: getErrorMessage(e) };
        }
        await onDone({ ...outcome, executionId: runner.id }).catch((e: unknown) => log.error("Recording the integrity check failed", {}, wrapError(e)));
    })();

    return { executionId: runner.id, pending: true };
}
