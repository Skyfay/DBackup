import { describe, it, expect, vi, beforeEach } from "vitest";
import { stepRetention } from "@/lib/runner/steps/05-retention";
import type { RunnerContext, DestinationContext } from "@/lib/runner/types";

/**
 * The configuration backup is for a platform admin alone, its files included. A job of the home
 * tenant may use the same destination, so its retention must never delete a file of the
 * configuration backup, whatever the job is called.
 */

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/services/dashboard-service", () => ({ refreshStorageStatsCache: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/storage/storage-service", () => ({
    storageService: {
        removeStorageListCacheEntry: vi.fn().mockResolvedValue(undefined),
        readCachedListing: vi.fn().mockResolvedValue(null),
    },
}));
vi.mock("@/lib/prisma", () => ({ default: { systemSetting: { findUnique: vi.fn().mockResolvedValue(null) } } }));

const at = (day: number) => new Date(Date.UTC(2026, 9, day, 3, 0, 0));
const file = (path: string, day: number) => ({ name: path.split("/").pop()!, path, size: 100, lastModified: at(day) });

/** What the configuration runner writes beside its file: no job, `sourceType: "SYSTEM"`. */
const configSidecar = (day: number) => JSON.stringify({ version: "2.0", kind: "database", sourceType: "SYSTEM", timestamp: at(day).toISOString() });
const jobSidecar = (day: number) => JSON.stringify({ jobId: "job-1", timestamp: at(day).toISOString() });

function destination(): DestinationContext {
    const listing = [
        file("config-backups/config_backup_2026-10-01T03-00-00-000Z.db.gz.enc", 1),
        file("config-backups/config_backup_2026-10-01T03-00-00-000Z.db.gz.enc.meta.json", 1),
        file("config-backups/config_backup_2026-10-02T03-00-00-000Z.db.gz.enc", 2),
        file("config-backups/config_backup_2026-10-02T03-00-00-000Z.db.gz.enc.meta.json", 2),
        file("config-backups/job_2026-10-03.tar", 3),
        file("config-backups/job_2026-10-03.tar.meta.json", 3),
    ];
    return {
        configId: "cfg-config-destination",
        configName: "Platform storage",
        adapterId: "local-filesystem",
        config: {},
        retention: { mode: "SIMPLE", simple: { keepCount: 1 } } as never,
        priority: 0,
        adapter: {
            upload: vi.fn(),
            list: vi.fn().mockResolvedValue(listing),
            read: vi.fn(async (_config: unknown, path: string) => {
                if (path.startsWith("config-backups/config_backup_2026-10-01")) return configSidecar(1);
                if (path.startsWith("config-backups/config_backup_2026-10-02")) return configSidecar(2);
                return jobSidecar(3);
            }),
            delete: vi.fn().mockResolvedValue(undefined),
        } as never,
        uploadResult: { success: true, path: "config-backups/job_2026-10-03.tar" },
    } as DestinationContext;
}

function context(dest: DestinationContext): RunnerContext {
    return {
        jobId: "job-1",
        // A job of the home tenant called like the folder of the configuration backup.
        job: { id: "job-1", name: "config-backups", tenantId: "default" } as never,
        execution: { id: "exec-1", tenantId: "default" } as never,
        logs: [],
        log: vi.fn(),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        destinations: [dest],
        status: "Success",
        startedAt: new Date(),
    } as unknown as RunnerContext;
}

const deletedOf = (dest: DestinationContext) => (dest.adapter.delete as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[1]));

describe("retention of a job on the destination of the configuration backup", () => {
    beforeEach(() => vi.clearAllMocks());

    it("never deletes a file of the configuration backup, also for a job called config-backups", async () => {
        const dest = destination();
        await stepRetention(context(dest));
        expect(deletedOf(dest).filter((path) => path.includes("config_backup_"))).toEqual([]);
    });

    it("leaves the folder alone the way a storage that ignores the case and trailing dots reads it", async () => {
        const dest = destination();
        const renamed = [
            file("Config-Backups./config_backup_2026-10-01T03-00-00-000Z.db.gz.enc", 1),
            file("Config-Backups./job_2026-10-02.tar", 2),
            file("Config-Backups./job_2026-10-03.tar", 3),
        ];
        (dest.adapter.list as ReturnType<typeof vi.fn>).mockResolvedValue(renamed);
        (dest.adapter.read as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        dest.uploadResult = { success: true, path: "Config-Backups./job_2026-10-03.tar" };

        await stepRetention(context(dest));

        expect(deletedOf(dest)).toEqual([]);
    });

    it("never counts a file whose sidecar marks a configuration backup, wherever it lies", async () => {
        const listing = [
            file("nightly/moved-copy.db.gz.enc", 1),
            file("nightly/moved-copy.db.gz.enc.meta.json", 1),
            file("nightly/job_2026-10-02.tar", 2),
            file("nightly/job_2026-10-02.tar.meta.json", 2),
            file("nightly/job_2026-10-03.tar", 3),
            file("nightly/job_2026-10-03.tar.meta.json", 3),
        ];
        const dest = destination();
        (dest.adapter.list as ReturnType<typeof vi.fn>).mockResolvedValue(listing);
        (dest.adapter.read as ReturnType<typeof vi.fn>).mockImplementation(async (_config: unknown, path: string) =>
            path.startsWith("nightly/moved-copy") ? configSidecar(1) : jobSidecar(path.includes("10-02") ? 2 : 3));
        dest.uploadResult = { success: true, path: "nightly/job_2026-10-03.tar" };

        await stepRetention({ ...context(dest), job: { id: "job-1", name: "nightly", tenantId: "default" } } as unknown as RunnerContext);

        // The policy keeps one: the older backup of the job goes, the configuration backup stays.
        expect(deletedOf(dest)).toContain("nightly/job_2026-10-02.tar");
        expect(deletedOf(dest).filter((path) => path.startsWith("nightly/moved-copy"))).toEqual([]);
    });

    it("still prunes the backups of a job whose names start like those of the configuration backup", async () => {
        // A job called "Config Backup" gets file names like Config_Backup_2026-10-02 from the default template.
        const listing = [
            file("Config Backup/Config_Backup_2026-10-02.tar", 2),
            file("Config Backup/Config_Backup_2026-10-02.tar.meta.json", 2),
            file("Config Backup/Config_Backup_2026-10-03.tar", 3),
            file("Config Backup/Config_Backup_2026-10-03.tar.meta.json", 3),
            // One copied there by hand, whose sidecar names no job.
            file("Config Backup/config_backup_2026-10-01T03-00-00-000Z.db.gz.enc", 1),
        ];
        const dest = destination();
        (dest.adapter.list as ReturnType<typeof vi.fn>).mockResolvedValue(listing);
        (dest.adapter.read as ReturnType<typeof vi.fn>).mockImplementation(async (_config: unknown, path: string) =>
            path.includes("db.gz.enc") ? null : jobSidecar(path.includes("10-02") ? 2 : 3));
        dest.uploadResult = { success: true, path: "Config Backup/Config_Backup_2026-10-03.tar" };

        await stepRetention({ ...context(dest), job: { id: "job-1", name: "Config Backup", tenantId: "default" } } as unknown as RunnerContext);

        expect(deletedOf(dest)).toContain("Config Backup/Config_Backup_2026-10-02.tar");
        expect(deletedOf(dest).filter((path) => path.includes("db.gz.enc"))).toEqual([]);
    });
});
