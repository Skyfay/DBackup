import { describe, it, expect, vi, beforeEach } from "vitest";

const DB_FILE = "/data/db/dbackup.db";
const PAGE_SIZE = 4096;

/** Simulated on-disk state, changed by the VACUUM mock. */
const disk = {
    fileBytes: 0,
    walBytes: 0 as number | null,
    pageCount: 0,
    freePages: 0,
    journalMode: "wal",
    freeBytes: 0,
};

const queryRawUnsafe = vi.fn();
const executeRawUnsafe = vi.fn();
const executeRaw = vi.fn();
const executionCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
    default: {
        $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...a),
        $executeRawUnsafe: (...a: unknown[]) => executeRawUnsafe(...a),
        $executeRaw: (...a: unknown[]) => executeRaw(...a),
        execution: { count: (...a: unknown[]) => executionCount(...a) },
    },
}));

const stat = vi.fn();
const statfs = vi.fn();
const unlink = vi.fn();
vi.mock("fs/promises", () => {
    const api = {
        stat: (...a: unknown[]) => stat(...a),
        statfs: (...a: unknown[]) => statfs(...a),
        unlink: (...a: unknown[]) => unlink(...a),
    };
    return { default: api, ...api };
});

vi.mock("@/lib/temp-dir", () => ({
    getTempDir: () => "/tmp",
    getTempPath: (name: string) => `/tmp/${name}`,
}));

const processQueue = vi.fn();
vi.mock("@/lib/execution/queue-manager", () => ({ processQueue: (...a: unknown[]) => processQueue(...a) }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { getDatabaseInfo, vacuumDatabase, createDatabaseSnapshot } = await import("@/services/system/database-service");
const { beginDatabaseMaintenance, endDatabaseMaintenance, isDatabaseMaintenanceActive, DATABASE_BUSY } = await import(
    "@/lib/server/database-maintenance"
);

function enoent() {
    return Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}

describe("Database service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        endDatabaseMaintenance();

        Object.assign(disk, {
            fileBytes: 1000 * PAGE_SIZE,
            walBytes: 200 * PAGE_SIZE,
            pageCount: 1000,
            freePages: 400,
            journalMode: "wal",
            freeBytes: 10_000 * PAGE_SIZE,
        });

        // Prisma hands integer PRAGMA results back as BigInt.
        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.startsWith("PRAGMA database_list")) return [{ seq: BigInt(0), name: "main", file: DB_FILE }];
            if (sql.startsWith("PRAGMA page_size")) return [{ page_size: BigInt(PAGE_SIZE) }];
            if (sql.startsWith("PRAGMA page_count")) return [{ page_count: BigInt(disk.pageCount) }];
            if (sql.startsWith("PRAGMA freelist_count")) return [{ freelist_count: BigInt(disk.freePages) }];
            if (sql.startsWith("PRAGMA journal_mode")) return [{ journal_mode: disk.journalMode }];
            if (sql.startsWith("PRAGMA wal_checkpoint")) {
                disk.walBytes = 0;
                return [{ busy: BigInt(0), log: BigInt(0), checkpointed: BigInt(0) }];
            }
            throw new Error(`unexpected query ${sql}`);
        });
        stat.mockImplementation(async (file: string) => {
            if (file === DB_FILE) return { size: disk.fileBytes };
            if (file === `${DB_FILE}-wal`) {
                if (disk.walBytes === null) throw enoent();
                return { size: disk.walBytes };
            }
            if (file.startsWith("/tmp/")) return { size: 600 * PAGE_SIZE };
            throw enoent();
        });
        statfs.mockImplementation(async () => ({ bavail: disk.freeBytes / PAGE_SIZE, bsize: PAGE_SIZE }));
        unlink.mockResolvedValue(undefined);
        executionCount.mockResolvedValue(0);
        processQueue.mockResolvedValue(undefined);
    });

    describe("size information", () => {
        it("reports the files, the used pages and at least what a VACUUM gives back", async () => {
            const info = await getDatabaseInfo();

            expect(info).toEqual({
                path: DB_FILE,
                journalMode: "wal",
                fileBytes: 1000 * PAGE_SIZE,
                walBytes: 200 * PAGE_SIZE,
                totalBytes: 1200 * PAGE_SIZE,
                usedBytes: 600 * PAGE_SIZE,
                reclaimableBytes: 600 * PAGE_SIZE,
                freeDiskBytes: 10_000 * PAGE_SIZE,
            });
        });

        it("counts a missing WAL file as zero, as outside WAL mode", async () => {
            disk.walBytes = null;
            disk.journalMode = "delete";

            const info = await getDatabaseInfo();

            expect(info.walBytes).toBe(0);
            expect(info.totalBytes).toBe(1000 * PAGE_SIZE);
        });
    });

    describe("VACUUM", () => {
        it("rebuilds the file, truncates the WAL and reports the space it freed", async () => {
            executeRawUnsafe.mockImplementation(async () => {
                disk.fileBytes = 600 * PAGE_SIZE;
                disk.pageCount = 600;
                disk.freePages = 0;
                return 0;
            });

            const result = await vacuumDatabase();

            expect(executeRawUnsafe).toHaveBeenCalledWith("VACUUM;");
            expect(queryRawUnsafe).toHaveBeenCalledWith("PRAGMA wal_checkpoint(TRUNCATE);");
            expect(result.beforeBytes).toBe(1200 * PAGE_SIZE);
            expect(result.afterBytes).toBe(600 * PAGE_SIZE);
            expect(isDatabaseMaintenanceActive()).toBe(false);
        });

        it("is refused while a backup or restore is running", async () => {
            executionCount.mockResolvedValue(2);

            await expect(vacuumDatabase()).rejects.toMatchObject({ code: DATABASE_BUSY, message: expect.stringMatching(/2 runs are in progress/) });
            expect(executeRawUnsafe).not.toHaveBeenCalled();
            expect(isDatabaseMaintenanceActive()).toBe(false);
        });

        it("is refused while another maintenance operation holds the database", async () => {
            beginDatabaseMaintenance();

            await expect(vacuumDatabase()).rejects.toMatchObject({ code: DATABASE_BUSY });
            expect(executionCount).not.toHaveBeenCalled();
            // The flag belongs to the other operation and stays set.
            expect(isDatabaseMaintenanceActive()).toBe(true);
        });

        it("is refused when the disk cannot hold the rebuilt database", async () => {
            disk.freeBytes = 100 * PAGE_SIZE;

            await expect(vacuumDatabase()).rejects.toMatchObject({ code: DATABASE_BUSY, message: expect.stringMatching(/Not enough free disk space/) });
            expect(executeRawUnsafe).not.toHaveBeenCalled();
        });

        it("releases the database and resumes queued jobs even when VACUUM fails", async () => {
            executeRawUnsafe.mockRejectedValue(new Error("disk I/O error"));

            await expect(vacuumDatabase()).rejects.toThrow("disk I/O error");

            expect(isDatabaseMaintenanceActive()).toBe(false);
            await vi.waitFor(() => expect(processQueue).toHaveBeenCalled());
        });
    });

    describe("snapshot for download", () => {
        it("writes a consistent copy to a temp file with VACUUM INTO", async () => {
            executeRaw.mockResolvedValue(0);

            const snapshot = await createDatabaseSnapshot();

            const [, target] = executeRaw.mock.calls[0];
            expect(target).toMatch(/^\/tmp\/dbackup-database-\d+-[0-9a-f-]+\.db$/);
            expect(snapshot.tempFile).toBe(target);
            expect(snapshot.sizeBytes).toBe(600 * PAGE_SIZE);
            expect(snapshot.fileName).toMatch(/^dbackup-database_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/);
            expect(isDatabaseMaintenanceActive()).toBe(false);
        });

        it("removes the partial temp file when the copy fails", async () => {
            executeRaw.mockRejectedValue(new Error("disk full"));

            await expect(createDatabaseSnapshot()).rejects.toThrow("disk full");

            const [, target] = executeRaw.mock.calls[0];
            expect(unlink).toHaveBeenCalledWith(target);
        });

        it("is refused while a run is in progress", async () => {
            executionCount.mockResolvedValue(1);

            await expect(createDatabaseSnapshot()).rejects.toMatchObject({ code: DATABASE_BUSY, message: expect.stringMatching(/1 run is in progress/) });
            expect(executeRaw).not.toHaveBeenCalled();
        });
    });
});
