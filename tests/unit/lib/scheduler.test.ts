
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackupScheduler } from '@/lib/server/scheduler';
import prisma from '@/lib/prisma';
import cron from 'node-cron';
import { runJob } from '@/lib/runner';
import { systemTaskService, SYSTEM_TASKS } from '@/services/system/system-task-service';

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
    default: {
        job: {
            findMany: vi.fn(),
        },
        systemSetting: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock('@/lib/runner', () => ({
    runJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/system/system-task-service', () => ({
    systemTaskService: {
        getTaskConfig: vi.fn(),
        getTaskEnabled: vi.fn(),
        getTaskRunOnStartup: vi.fn(),
        runTask: vi.fn().mockResolvedValue(undefined),
    },
    SYSTEM_TASKS: {
        HEALTH_CHECK: 'health_check',
    }
}));

// Mock node-cron
vi.mock('node-cron', () => ({
    default: {
        validate: vi.fn(),
        schedule: vi.fn(),
    },
}));

describe('BackupScheduler', () => {
    let scheduler: BackupScheduler;

    beforeEach(() => {
        vi.clearAllMocks();
        scheduler = new BackupScheduler();

        // Default mocks
        // @ts-expect-error -- Mock setup
        cron.validate.mockReturnValue(true);
        // @ts-expect-error -- Mock setup
        cron.schedule.mockReturnValue({ stop: vi.fn() });
        // @ts-expect-error -- Mock setup
        prisma.job.findMany.mockResolvedValue([]);
        // @ts-expect-error -- Mock setup
        prisma.systemSetting.findUnique.mockResolvedValue(null);
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskConfig.mockResolvedValue(null);
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskEnabled.mockResolvedValue(false);
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskRunOnStartup.mockResolvedValue(false);
    });

    it('should initialize and refresh jobs', async () => {
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskEnabled.mockResolvedValue(true);

        await scheduler.init();
        expect(prisma.job.findMany).toHaveBeenCalledWith({ where: { enabled: true }, include: { schedulePreset: true } });
        expect(systemTaskService.getTaskConfig).toHaveBeenCalled();
    });

    it('should schedule enabled jobs with valid cron expressions', async () => {
        const jobs = [
            { id: 'job1', name: 'Job 1', schedule: '0 0 * * *', enabled: true },
            { id: 'job2', name: 'Job 2', schedule: '*/5 * * * *', enabled: true },
        ];
        // @ts-expect-error -- Mock setup
        prisma.job.findMany.mockResolvedValue(jobs);

        await scheduler.refresh();

        expect(cron.validate).toHaveBeenCalledWith('0 0 * * *');
        expect(cron.validate).toHaveBeenCalledWith('*/5 * * * *');
        expect(cron.schedule).toHaveBeenCalledTimes(2);
        expect(cron.schedule).toHaveBeenCalledWith('0 0 * * *', expect.any(Function), { timezone: 'UTC' });

        // Verify scheduled callback calls runJob
        // Get the callback passed to schedule for the first job
        // @ts-expect-error -- Mock setup
        const callback = cron.schedule.mock.calls[0][1];
        callback();
        expect(runJob).toHaveBeenCalledWith('job1', { type: "Scheduler", label: "Scheduler" });
    });

    it('should not schedule job if cron expression is invalid', async () => {
        const jobs = [
            { id: 'job1', name: 'Job 1', schedule: 'invalid-cron', enabled: true },
        ];
        // @ts-expect-error -- Mock setup
        prisma.job.findMany.mockResolvedValue(jobs);
        // @ts-expect-error -- Mock setup
        cron.validate.mockImplementation((s: string) => s !== 'invalid-cron');

        await scheduler.refresh();

        expect(cron.schedule).not.toHaveBeenCalled();
    });

    it('should stop existing tasks before refreshing', async () => {
        const jobs = [
            { id: 'job1', name: 'Job 1', schedule: '0 0 * * *', enabled: true },
        ];
        // @ts-expect-error -- Mock setup
        prisma.job.findMany.mockResolvedValue(jobs);

        const stopMock = vi.fn();
        // @ts-expect-error -- Mock setup
        cron.schedule.mockReturnValue({ stop: stopMock });

        // First load
        await scheduler.refresh();
        expect(cron.schedule).toHaveBeenCalledTimes(1);

        // Second load
        await scheduler.refresh();

        // Should have stopped the previous task
        expect(stopMock).toHaveBeenCalled();
        // Should have scheduled again
        expect(cron.schedule).toHaveBeenCalledTimes(2);
    });

    it('should schedule system tasks if configured', async () => {
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskConfig.mockResolvedValue('0 2 * * *'); // Daily at 2am
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskEnabled.mockResolvedValue(true);

        await scheduler.refresh();

        expect(cron.schedule).toHaveBeenCalledWith('0 2 * * *', expect.any(Function), { timezone: 'UTC' });

        // Verify callback executes system task
        // @ts-expect-error -- Mock setup
        const callback = cron.schedule.mock.lastCall[1];
        callback();
        expect(systemTaskService.runTask).toHaveBeenCalledWith(SYSTEM_TASKS.HEALTH_CHECK);
    });

    it('should not update schedule if loading from DB fails', async () => {
        // @ts-expect-error -- Mock setup
        prisma.job.findMany.mockRejectedValue(new Error('DB connection failed'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await scheduler.refresh();

        expect(cron.schedule).not.toHaveBeenCalled();
        // Logger outputs a single formatted string containing the message
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load jobs'));
    });

    it('queues a concurrent refresh call and runs it after the current refresh completes', async () => {
        let resolveFirst!: (jobs: any[]) => void;
        (prisma.job.findMany as ReturnType<typeof vi.fn>)
            .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
            .mockResolvedValue([]);

        const first = scheduler.refresh();
        const second = scheduler.refresh(); // hits the concurrent guard
        await second; // returns immediately since refreshing = true

        // Only one DB query has been made (the blocked first refresh)
        expect(prisma.job.findMany).toHaveBeenCalledTimes(1);

        // Let first refresh complete
        resolveFirst([]);
        await first;

        // The queued refresh runs via setImmediate - wait for it to fire
        await vi.waitFor(() => expect(prisma.job.findMany).toHaveBeenCalledTimes(2));
    });

    it('schedules a delayed startup run for system tasks with runOnStartup enabled', async () => {
        vi.useFakeTimers();

        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskEnabled.mockResolvedValue(true);
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskConfig.mockResolvedValue(null); // no cron schedule
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskRunOnStartup.mockResolvedValue(true);

        await scheduler.init();

        expect(systemTaskService.runTask).not.toHaveBeenCalled();

        await vi.runAllTimersAsync();

        expect(systemTaskService.runTask).toHaveBeenCalledWith(SYSTEM_TASKS.HEALTH_CHECK);
        vi.useRealTimers();
    });

    it("does not start the tasks set to run at start again when a saved job or setting refreshes it", async () => {
        vi.useFakeTimers();

        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskEnabled.mockResolvedValue(true);
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskRunOnStartup.mockResolvedValue(true);

        await scheduler.init();
        await vi.runAllTimersAsync();
        expect(systemTaskService.runTask).toHaveBeenCalledTimes(1);

        await scheduler.refresh();
        await scheduler.refresh();
        await vi.runAllTimersAsync();

        expect(systemTaskService.runTask).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it("leaves a task that is off out of the runs at start", async () => {
        vi.useFakeTimers();

        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskEnabled.mockResolvedValue(false);
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskRunOnStartup.mockResolvedValue(true);

        await scheduler.init();
        await vi.runAllTimersAsync();

        expect(systemTaskService.runTask).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('logs an error when a system task throws during scheduling', async () => {
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskEnabled.mockRejectedValue(new Error('service unavailable'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await scheduler.refresh();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to schedule task'));
    });

    it('logs error when a scheduled job fails during execution', async () => {
        const jobs = [{ id: 'job1', name: 'Job 1', schedule: '0 0 * * *', enabled: true }];
        // @ts-expect-error -- Mock setup
        prisma.job.findMany.mockResolvedValue(jobs);
        (runJob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('backup failed'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await scheduler.refresh();

        // Invoke the cron callback to trigger the job (and the .catch handler)
        // @ts-expect-error -- Mock setup
        const callback = cron.schedule.mock.calls[0][1];
        callback();

        await vi.waitFor(() =>
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Job failed'))
        );
    });

    it('logs error when a scheduled system task fails during execution', async () => {
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskEnabled.mockResolvedValue(true);
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskConfig.mockResolvedValue('0 2 * * *');
        // @ts-expect-error -- Mock setup
        systemTaskService.runTask.mockRejectedValueOnce(new Error('task failed'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await scheduler.refresh();

        // Invoke the cron callback for the system task
        // @ts-expect-error -- Mock setup
        const callback = cron.schedule.mock.lastCall[1];
        callback();

        await vi.waitFor(() =>
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('System task failed'))
        );
    });

    it('logs error when a startup system task fails', async () => {
        vi.useFakeTimers();

        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskEnabled.mockResolvedValue(true);
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskConfig.mockResolvedValue(null);
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskRunOnStartup.mockResolvedValue(true);
        // @ts-expect-error -- Mock setup
        systemTaskService.runTask.mockRejectedValue(new Error('startup failed'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await scheduler.init();
        await vi.runAllTimersAsync();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Startup task failed'));
        vi.useRealTimers();
    });

    it('skips scheduling system task when its cron expression is invalid', async () => {
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskEnabled.mockResolvedValue(true);
        // @ts-expect-error -- Mock setup
        systemTaskService.getTaskConfig.mockResolvedValue('not-a-valid-cron');
        // @ts-expect-error -- Mock setup
        cron.validate.mockImplementation((s: string) => s !== 'not-a-valid-cron');

        await scheduler.refresh();

        // System task should not be scheduled since its expression is invalid
        expect(cron.schedule).not.toHaveBeenCalled();
    });
});
