import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import prisma from "@/lib/prisma";
import { runJob } from "@/lib/runner";
import { systemTaskService, SYSTEM_TASKS } from "@/services/system-task-service";

export class BackupScheduler {
    private tasks: Map<string, ScheduledTask> = new Map();

    constructor() {
        this.tasks = new Map();
    }

    async init() {
        console.log("[Scheduler] Initializing...");
        await this.refresh();
    }

    async refresh() {
        console.log("[Scheduler] Refreshing jobs...");

        // Stop all existing tasks to avoid duplicates
        this.stopAll();

        try {
            // 1. User Jobs
            const jobs = await prisma.job.findMany({
                where: { enabled: true }
            });

            console.log(`[Scheduler] Found ${jobs.length} enabled jobs.`);

            for (const job of jobs) {
                if (cron.validate(job.schedule)) {
                    console.log(`[Scheduler] Scheduling job '${job.name}' (${job.id}) with '${job.schedule}'`);

                    const task = cron.schedule(job.schedule, () => {
                        console.log(`[Scheduler] Triggering job '${job.name}'`);
                        runJob(job.id).catch(e => console.error(`[Scheduler] Job ${job.id} failed:`, e));
                    });

                    this.tasks.set(job.id, task);
                } else {
                    console.error(`[Scheduler] Invalid cron schedule for job ${job.id}: ${job.schedule}`);
                }
            }

            // 2. System Tasks
            for (const taskId of Object.values(SYSTEM_TASKS)) {
                try {
                    const enabled = await systemTaskService.getTaskEnabled(taskId);
                    if (!enabled) {
                        console.log(`[Scheduler] System Task '${taskId}' is disabled.`);
                        continue;
                    }

                    const schedule = await systemTaskService.getTaskConfig(taskId);
                    if (schedule && cron.validate(schedule)) {
                        console.log(`[Scheduler] Scheduling system task '${taskId}' with '${schedule}'`);
                        const task = cron.schedule(schedule, () => {
                            systemTaskService.runTask(taskId).catch(e => console.error(`[Scheduler] System Task ${taskId} failed:`, e));
                        });
                        this.tasks.set(taskId, task);
                    }

                    // Check for Run on Startup
                    const runOnStartup = await systemTaskService.getTaskRunOnStartup(taskId);
                    if (runOnStartup) {
                        console.log(`[Scheduler] Scheduling startup run for system task '${taskId}' in 10s`);
                        setTimeout(() => {
                            console.log(`[Scheduler] Running startup task '${taskId}'`);
                            systemTaskService.runTask(taskId).catch(e => console.error(`[Scheduler] Startup Task ${taskId} failed:`, e));
                        }, 10000);
                    }
                } catch(e) { console.error(`[Scheduler] Failed to schedule task ${taskId}`, e); }
            }
        } catch (error) {
            console.error("[Scheduler] Failed to load jobs from DB", error);
        }
    }

    stopAll() {
        this.tasks.forEach(task => task.stop());
        this.tasks.clear();
    }
}

// Singleton pattern to prevent multiple schedulers in dev hot-reload
const globalForScheduler = globalThis as unknown as { scheduler: BackupScheduler };

export const scheduler = globalForScheduler.scheduler || new BackupScheduler();

if (process.env.NODE_ENV !== 'production') globalForScheduler.scheduler = scheduler;
