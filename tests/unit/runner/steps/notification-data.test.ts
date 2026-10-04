import { describe, it, expect, vi, beforeEach } from "vitest";
import { backupEventData } from "@/lib/runner/steps/notification-data";
import type { RunnerContext } from "@/lib/runner/types";

const prismaMock = vi.hoisted(() => ({
    execution: { findMany: vi.fn(), findFirst: vi.fn() },
    encryptionProfile: { findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeCtx(overrides: Partial<RunnerContext> = {}): RunnerContext {
    return {
        jobId: "job-1",
        job: {
            id: "job-1",
            name: "postgres-nightly",
            encryptionProfileId: "key-1",
            source: { id: "src-1", name: "Postgres Prod", adapterId: "postgres" },
        } as unknown as RunnerContext["job"],
        execution: { id: "run-9", triggerType: "Scheduler" } as unknown as RunnerContext["execution"],
        logs: [],
        log: vi.fn(),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        sources: [],
        destinations: [
            { configId: "d1", configName: "S3 Archive", adapterId: "s3-aws", uploadResult: { success: true } },
            { configId: "d2", configName: "Dropbox", adapterId: "dropbox", uploadResult: { success: false, error: "Error 401: expired_access_token" } },
            { configId: "d3", configName: "USB", adapterId: "local-filesystem", uploadResult: { success: false, skipped: true } },
            { configId: "d4", configName: "NAS", adapterId: "smb" },
        ] as unknown as RunnerContext["destinations"],
        startedAt: new Date("2026-10-04T00:00:00.000Z"),
        metadata: { count: 3, engineVersion: "16.4" },
        ...overrides,
    } as RunnerContext;
}

describe("what the notification of a run says about it", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.encryptionProfile.findUnique.mockResolvedValue({ name: "Main key" });
        prismaMock.execution.findMany.mockResolvedValue([]);
        prismaMock.execution.findFirst.mockResolvedValue(null);
    });

    it("tells how the upload went at each destination", async () => {
        const data = await backupEventData(makeCtx(), false, "UTC");

        expect(data.destinations).toEqual([
            { name: "S3 Archive", adapterId: "s3-aws", state: "ok", detail: "Uploaded" },
            { name: "Dropbox", adapterId: "dropbox", state: "failed", detail: "Upload failed", error: "Error 401: expired_access_token" },
            { name: "USB", adapterId: "local-filesystem", state: "skipped", detail: "Not connected" },
            { name: "NAS", adapterId: "smb", state: "skipped", detail: "Not reached" },
        ]);
    });

    it("names the source with its type and version, the key and who started the run", async () => {
        const data = await backupEventData(makeCtx(), false, "UTC");

        expect(data.sourceType).toBe("PostgreSQL 16.4");
        expect(data.encryptionKey).toBe("Main key");
        expect(data.trigger).toBe("Scheduler");
        expect(data.databases).toBe(3);
        expect(data.failedInARow).toBeUndefined();
    });

    it("counts the failed runs in a row up to the last one that did not fail", async () => {
        prismaMock.execution.findMany.mockResolvedValue([{ status: "Failed" }, { status: "Failed" }, { status: "Success" }, { status: "Failed" }]);
        prismaMock.execution.findFirst.mockResolvedValue({ startedAt: new Date("2026-10-02T00:00:00.000Z"), endedAt: new Date("2026-10-02T00:01:10.000Z") });

        const data = await backupEventData(makeCtx(), true, "UTC");

        expect(data.failedInARow).toBe(3);
        expect(data.lastSuccessAt).toBe("2026-10-02T00:01:10.000Z");
    });

    it("tells the first error of the log in plain words with its step and time", async () => {
        const ctx = makeCtx({
            logs: [{
                timestamp: "2026-10-04T00:00:04.000Z",
                level: "error",
                type: "general",
                stage: "Dumping Databases",
                message: 'pg_dump: error: FATAL: password authentication failed for user "backup"',
            }],
        });

        const data = await backupEventData(ctx, true, "Europe/Zurich");

        expect(data.problem).toEqual({
            title: "Postgres Prod refused the login",
            help: "Check the user and password of the connection, or its credential profile.",
            raw: 'pg_dump: error: FATAL: password authentication failed for user "backup"',
            where: "Dumping databases · 02:00:04",
        });
    });

    it("still sends when the earlier runs cannot be read", async () => {
        prismaMock.execution.findMany.mockRejectedValue(new Error("database is locked"));

        const data = await backupEventData(makeCtx(), true, "UTC");

        expect(data.failedInARow).toBe(1);
    });
});
