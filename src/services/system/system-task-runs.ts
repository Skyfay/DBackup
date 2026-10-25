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
import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { getErrorMessage, wrapError } from "@/lib/logging/errors";
import { recordVersionIfChanged } from "./db-version-service";
import { databaseListService } from "@/services/databases/database-list-service";
import type { IntegrityCheckResult, IntegrityCopy } from "@/services/backup/integrity-service";
import type { SystemTaskRunner } from "@/lib/runner/system-task-runner";
import { isAirGapped, isNotConnected } from "@/lib/core/air-gap";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

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
    const rows = await prisma.adapterConfig.findMany({
        where: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
        select: { id: true, name: true, type: true, storageRole: true, metadata: true, lastStatus: true, tenantId: true },
    });
    // An air-gapped destination that is not connected is compared the next hour it is.
    const adapters = rows.filter((row) => !isNotConnected(row));
    // A shared destination has a listing for each customer that has one, besides the one of its tenant.
    const listings = await prisma.storageListCache.findMany({
        where: { adapterConfigId: { in: adapters.map((adapter) => adapter.id) } },
        select: { adapterConfigId: true, tenantId: true },
    });
    const cachedFor = new Set(listings.map((listing) => `${listing.adapterConfigId}\n${listing.tenantId}`));
    const places = [
        ...adapters.map((adapter) => ({ adapter, tenantId: adapter.tenantId })),
        ...listings.flatMap((listing) => {
            const adapter = adapters.find((entry) => entry.id === listing.adapterConfigId);
            return adapter && listing.tenantId !== adapter.tenantId ? [{ adapter, tenantId: listing.tenantId }] : [];
        }),
    ];
    log.info("Pre-warming storage cache", { count: adapters.length, listings: places.length });
    const { storageService } = await import("@/services/storage/storage-service");
    const { viewModeOf } = await import("@/services/sharing/destination-access");
    // A destination counts once, however many listings of it failed.
    const failed = new Set<string>();
    for (const { adapter, tenantId } of places) {
        try {
            // A customer the destination is no longer shared with keeps nothing of it. Asked before
            // the listing, since a listing that fails says nothing about who may use the destination.
            if (tenantId !== adapter.tenantId && !(await viewModeOf(adapter, tenantId))) {
                await prisma.storageListCache.deleteMany({ where: { adapterConfigId: adapter.id, tenantId } });
                log.debug("Dropped the listing of a tenant the destination is no longer shared with", { adapterId: adapter.id, tenantId });
                continue;
            }
            // If a cache row already exists: reconcile against remote to detect external changes.
            // If no cache row: do a full fetch to populate it.
            if (cachedFor.has(`${adapter.id}\n${tenantId}`)) {
                await storageService.reconcileStorageListCache(adapter.id, tenantId);
                log.debug("Reconciled storage cache", { adapterId: adapter.id, name: adapter.name, tenantId });
            } else {
                await storageService.listFilesWithMetadata(adapter.id);
                log.debug("Warmed storage cache", { adapterId: adapter.id, name: adapter.name });
            }
        } catch (e: unknown) {
            // Unplugged between its last check and now, which is no failure for an air-gapped one.
            if (isAirGapped(adapter)) continue;
            failed.add(adapter.id);
            log.warn("Failed to warm/reconcile cache for adapter", { adapterId: adapter.id, name: adapter.name, tenantId }, wrapError(e));
        }
    }
    if (failed.size > 0) return { ok: false, summary: `${failed.size} of ${plural(adapters.length, "destination", "destinations")} failed` };
    return { summary: plural(adapters.length, "destination", "destinations") };
}

export async function syncPermissions(): Promise<TaskOutcome> {
    try {
        log.debug("Syncing permissions for the groups with every permission");

        // Every permission a group of a tenant can hold. The rights of the platform stay out, no
        // group of a tenant ever stores one.
        const allPerms = AVAILABLE_PERMISSIONS.map((permission) => permission.id);

        // The checks give such a group every permission anyway. The stored list keeps the pages
        // that show it right, and a configuration backup of it complete.
        const result = await prisma.group.updateMany({
            where: { fullAccess: true },
            data: { permissions: JSON.stringify(allPerms) }
        });

        if (result.count > 0) {
            log.info("Updated permissions for the groups with every permission", { count: result.count });
            return { summary: `${allPerms.length} permissions` };
        }
        log.debug("No group with every permission found, skipping permission sync");
        return { ok: false, summary: "No group with every permission" };
    } catch (error: unknown) {
        log.error("Failed to sync permissions", {}, wrapError(error));
        return { ok: false, summary: getErrorMessage(error) };
    }
}

type CheckedCopy = Omit<IntegrityCopy, "index">;

/** How the check of the copies of one tenant went. No result when it failed as a whole. */
interface TenantCheck {
    /** The tenant whose run checked the copies, the tenant of the backups whatever destination holds them. */
    tenantId: string;
    result: IntegrityCheckResult | null;
    copies: CheckedCopy[];
    error?: string;
}

/**
 * Checks the copies of the tenant of the scope it runs in and records them in `runner`, a run of
 * that tenant: the plan, every copy with the last state it reached, the logs and the outcome.
 * Never throws, a check that fails as a whole fails its run.
 */
async function checkCopiesOfTenant(tenantId: string, runner: SystemTaskRunner): Promise<TenantCheck> {
    const { integrityService } = await import("@/services/backup/integrity-service");
    const { INTEGRITY_CHECK_STAGES } = await import("@/lib/core/logs");

    // Every copy it checked, kept in the metadata for the page of the run. The one it
    // checks now is the last entry, and each copy is written once, however often it changes.
    const copies: CheckedCopy[] = [];
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
            executionId: runner.id,
            total: result.totalFiles,
            passed: result.passed,
            failed: result.failed,
            skipped: result.skipped,
        });
        return { tenantId, result, copies };
    } catch (e: unknown) {
        runner.logEntry(getErrorMessage(e), "error");
        runner.setStage(INTEGRITY_CHECK_STAGES.FAILED);
        await runner.finish("Failed");
        log.error("Integrity check failed", { executionId: runner.id }, wrapError(e));
        return { tenantId, result: null, copies, error: getErrorMessage(e) };
    }
}

/** The outcome of the whole check for the Settings page, in numbers that name no tenant. */
function integrityOutcome(checks: TenantCheck[], unread: boolean): TaskOutcome {
    const sum = (pick: (result: IntegrityCheckResult) => number) => checks.reduce((total, check) => total + (check.result ? pick(check.result) : 0), 0);
    const failed = sum((result) => result.failed);
    const checked = sum((result) => result.passed) + failed;
    const scanFailed = sum((result) => result.scanFailed);
    const broken = checks.filter((check) => check.error);
    if (failed > 0) return { ok: false, summary: `${failed} of ${checked.toLocaleString("en-US")} failed` };
    if (broken.length > 0) return { ok: false, summary: checks.length === 1 ? broken[0].error : `Failed in ${plural(broken.length, "tenant", "tenants")}` };
    if (unread) return { ok: false, summary: "The other tenants could not be read" };
    if (scanFailed > 0) return { ok: false, summary: `${plural(scanFailed, "destination", "destinations")} unreachable` };
    return { summary: `${plural(checked, "backup", "backups")} passed` };
}

/**
 * Tells the platform about the copies that failed, and each tenant about the copies its own run
 * checked. The message of the platform and its row in the notification log of the home tenant name
 * the files and destinations of the home tenant alone, and of every other tenant only how many of
 * its copies failed, since each of them hears about its own copies by name on its own channels.
 */
async function reportIntegrityFailures(checks: TenantCheck[], triggerType: "Manual" | "Scheduler" | "Api", homeRunId: string): Promise<void> {
    const results = checks.flatMap((check) => (check.result ? [check.result] : []));
    const failed = results.reduce((total, result) => total + result.failed, 0);
    if (failed === 0) return;
    const home = checks.flatMap((check) => (check.tenantId === HOME_TENANT_ID && check.result ? [check.result] : []));
    const others = checks.flatMap((check) => (check.tenantId !== HOME_TENANT_ID && check.result && check.result.failed > 0 ? [{ tenantId: check.tenantId, result: check.result }] : []));
    // A name that cannot be read leaves the tenant unnamed, never the platform and the tenants untold.
    const tenantRows = others.length === 0 ? [] : await prisma.tenant.findMany({ where: { id: { in: others.map((other) => other.tenantId) } }, select: { id: true, name: true } })
        .catch((error: unknown) => {
            log.warn("Reading the names of the tenants for the integrity notice failed", {}, wrapError(error));
            return [];
        });
    const names = new Map((tenantRows ?? []).map((tenant) => [tenant.id, tenant.name]));
    await notify({
        eventType: NOTIFICATION_EVENTS.INTEGRITY_CHECK_FAILURE,
        data: {
            totalFiles: results.reduce((total, result) => total + result.totalFiles, 0),
            failed,
            passed: results.reduce((total, result) => total + result.passed, 0),
            skipped: results.reduce((total, result) => total + result.skipped, 0),
            triggerType,
            errors: home.flatMap((result) => result.errors),
            ...(others.length > 0
                ? { tenants: others.map(({ tenantId, result }) => ({ tenant: names.get(tenantId) ?? "A deleted tenant", failed: result.failed, totalFiles: result.totalFiles })) }
                : {}),
        },
    }, { executionId: homeRunId });
    // Each tenant hears about its own copies too, on its own channels. A customer's copy on a destination
    // another tenant shares is the customer's, whose run checked it, never the tenant's of the destination.
    const { notifyTenantsOfIntegrity } = await import("@/services/notifications/tenant-integrity");
    const copies = checks.flatMap((check) => check.copies.map((copy) => ({ ...copy, tenantId: check.tenantId })));
    await notifyTenantsOfIntegrity(copies, triggerType).catch((error: unknown) => {
        log.warn("Telling the tenants about the integrity check failed", { executionId: homeRunId }, wrapError(error));
    });
}

/**
 * Starts the integrity check in the background and hands back its run at once. `onDone` gets
 * the outcome of the whole check when it ends.
 *
 * The copies of each tenant are checked in a run of that tenant, with its own copies, logs and
 * outcome, so the History of a tenant never names the backups, destinations or jobs of another.
 * The run of the home tenant comes first and is the one handed back, then each other tenant with
 * something to check, one after the other, so only one run of the check is ever running.
 */
export async function startIntegrityCheck(
    triggerType: "Manual" | "Scheduler" | "Api" | undefined,
    triggerLabel: string | undefined,
    onDone: (outcome: TaskOutcome) => Promise<void>
): Promise<TaskOutcome> {
    const { integrityService } = await import("@/services/backup/integrity-service");
    const runners = await import("@/lib/runner/system-task-runner");
    const trigger = triggerType ?? "Scheduler";
    const homeRun = () => runners.SystemTaskRunner.create("IntegrityCheck", trigger, triggerLabel ?? "Scheduler");
    // The run of another tenant names the platform as who started it, never a person or a key of the
    // platform, whom the customer does not know. A scheduled one stays the scheduler's.
    const tenantRun = () => runners.SystemTaskRunner.create("IntegrityCheck", trigger, trigger === "Scheduler" ? (triggerLabel ?? "Scheduler") : "Platform");

    const home = await runAsTenant(HOME_TENANT_ID, homeRun);

    // Run async without blocking so callers receive the executionId immediately.
    (async () => {
        let outcome: TaskOutcome;
        try {
            let others: string[] = [];
            let unread = false;
            try {
                others = (await integrityService.tenantsToCheck()).filter((tenantId) => tenantId !== HOME_TENANT_ID);
            } catch (e: unknown) {
                unread = true;
                log.error("Reading the tenants to check failed", {}, wrapError(e));
            }
            // The other runs are made when their turn comes, a waiting run would be taken for a queued backup.
            // The run of the home tenant says nothing of the other tenants, whose runs are their own.
            const checks = [await runAsTenant(HOME_TENANT_ID, () => checkCopiesOfTenant(HOME_TENANT_ID, home))];
            for (const tenantId of others) {
                const check = await runAsTenant(tenantId, async () => checkCopiesOfTenant(tenantId, await tenantRun())).catch((e: unknown) => {
                    log.error("Starting the integrity check of a tenant failed", { tenantId }, wrapError(e));
                    const failed: TenantCheck = { tenantId, result: null, copies: [], error: getErrorMessage(e) };
                    return failed;
                });
                checks.push(check);
            }
            await reportIntegrityFailures(checks, trigger, home.id);
            outcome = integrityOutcome(checks, unread);
        } catch (e: unknown) {
            log.error("Integrity check failed", {}, wrapError(e));
            outcome = { ok: false, summary: getErrorMessage(e) };
        }
        await onDone({ ...outcome, executionId: home.id }).catch((e: unknown) => log.error("Recording the integrity check failed", {}, wrapError(e)));
    })();

    return { executionId: home.id, pending: true };
}
