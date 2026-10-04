import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import prisma from "@/lib/prisma";
import { runJob } from "@/lib/runner";
import { systemTaskService, SYSTEM_TASKS } from "@/services/system/system-task-service";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ module: "Scheduler" });

export class BackupScheduler {
    private tasks: Map<string, ScheduledTask> = new Map();
    private refreshing = false;
    private refreshQueued = false;

    constructor() {
        this.tasks = new Map();
    }

    async init() {
        log.info("Initializing scheduler");
        await this.refresh();
        await this.runStartupTasks();
    }

    /**
     * The system tasks set to run at start, once, a few seconds after DBackup started. A refresh
     * after a saved job or setting schedules again, but never starts them a second time.
     */
    private async runStartupTasks() {
        for (const taskId of Object.values(SYSTEM_TASKS)) {
            try {
                const [enabled, runOnStartup] = await Promise.all([
                    systemTaskService.getTaskEnabled(taskId),
                    systemTaskService.getTaskRunOnStartup(taskId),
                ]);
                if (!enabled || !runOnStartup) continue;
                log.debug("Scheduling startup run for system task", { taskId, delayMs: 10000 });
                setTimeout(() => {
                    log.debug("Running startup task", { taskId });
                    systemTaskService.runTask(taskId).catch((e) => log.error("Startup task failed", { taskId }, wrapError(e)));
                }, 10000);
            } catch (error) {
                log.error("Failed to schedule startup run", { taskId }, wrapError(error));
            }
        }
    }

    async refresh() {
        // Guard against concurrent refresh calls.
        // If a refresh is already running, queue one more to run after it finishes.
        // Any additional queued requests are collapsed into a single pending refresh.
        if (this.refreshing) {
            log.debug("Refresh already in progress - queuing");
            this.refreshQueued = true;
            return;
        }

        this.refreshing = true;
        this.refreshQueued = false;

        try {
            await this._doRefresh();
        } finally {
            this.refreshing = false;
            if (this.refreshQueued) {
                this.refreshQueued = false;
                log.debug("Running queued refresh");
                // Use setImmediate so the current call stack unwinds first
                setImmediate(() => {
                    this.refresh().catch((e) => log.error("Queued refresh failed", {}, wrapError(e)));
                });
            }
        }
    }

    private async _doRefresh() {
        log.info("Refreshing jobs");

        // Stop all existing tasks to avoid duplicates
        this.stopAll();

        // Read system timezone once for all tasks in this refresh cycle
        const tzSetting = await prisma.systemSetting.findUnique({ where: { key: "system.timezone" } });
        const timezone = tzSetting?.value || "UTC";
        log.debug("Scheduler timezone", { timezone });

        try {
            // 1. User Jobs
            const jobs = await prisma.job.findMany({
                where: { enabled: true },
                include: { schedulePreset: true }
            });

            log.info("Found enabled jobs", { count: jobs.length });

            for (const job of jobs) {
                // Use the live-linked preset schedule if one is set, otherwise fall back to job.schedule
                const effectiveSchedule = job.schedulePreset?.schedule ?? job.schedule;
                if (cron.validate(effectiveSchedule)) {
                    log.debug("Scheduling job", { jobName: job.name, jobId: job.id, schedule: effectiveSchedule, presetLinked: !!job.schedulePreset, timezone });

                    const task = cron.schedule(effectiveSchedule, () => {
                        log.debug("Triggering job", { jobName: job.name });
                        runJob(job.id, { type: "Scheduler", label: "Scheduler" }).catch((e) => log.error("Job failed", { jobId: job.id }, wrapError(e)));
                    }, { timezone });

                    this.tasks.set(job.id, task);
                } else {
                    log.error("Invalid cron schedule for job", { jobId: job.id, schedule: effectiveSchedule });
                }
            }

            // 2. System Tasks
            for (const taskId of Object.values(SYSTEM_TASKS)) {
                try {
                    const enabled = await systemTaskService.getTaskEnabled(taskId);
                    if (!enabled) {
                        log.debug("System task disabled", { taskId });
                        continue;
                    }

                    const schedule = await systemTaskService.getTaskConfig(taskId);
                    if (schedule && cron.validate(schedule)) {
                        log.debug("Scheduling system task", { taskId, schedule, timezone });
                        const task = cron.schedule(schedule, () => {
                            systemTaskService.runTask(taskId).catch((e) => log.error("System task failed", { taskId }, wrapError(e)));
                        }, { timezone });
                        this.tasks.set(taskId, task);
                    }
                } catch (error) {
                    log.error("Failed to schedule task", { taskId }, wrapError(error));
                }
            }
        } catch (error) {
            log.error("Failed to load jobs from DB", {}, wrapError(error));
        }
    }

    stopAll() {
        this.tasks.forEach(task => task.stop());
        this.tasks.clear();
    }
}

// Singleton - store on globalThis to survive module re-imports in both dev and prod.
// In dev, Next.js hot-reload can re-execute this module; in prod, certain Next.js
// internals can also reimport modules in a fresh module scope.
const globalForScheduler = globalThis as unknown as { scheduler: BackupScheduler };

export const scheduler = globalForScheduler.scheduler || new BackupScheduler();

globalForScheduler.scheduler = scheduler;
