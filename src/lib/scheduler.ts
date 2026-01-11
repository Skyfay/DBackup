import cron from "node-cron";
import prisma from "@/lib/prisma";
import { runJob } from "@/lib/runner";

export class BackupScheduler {
    private tasks: Map<string, cron.ScheduledTask> = new Map();

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
            // Fetch all enabled jobs
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
