import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";

const auditClean = vi.fn();
const healthClean = vi.fn();
const notificationClean = vi.fn();
const snapshotClean = vi.fn();
const purgeLogs = vi.fn();
const deleteRuns = vi.fn();
const trashClean = vi.fn();

vi.mock("@/services/audit-service", () => ({ auditService: { cleanOldLogs: (...a: unknown[]) => auditClean(...a) } }));
vi.mock("@/services/system/healthcheck-service", () => ({ healthCheckService: { cleanOldLogs: (...a: unknown[]) => healthClean(...a) } }));
vi.mock("@/services/notifications/notification-log-service", () => ({ cleanOldNotificationLogs: (...a: unknown[]) => notificationClean(...a) }));
vi.mock("@/services/dashboard-service", () => ({ cleanupOldSnapshots: (...a: unknown[]) => snapshotClean(...a) }));
vi.mock("@/services/system/execution-retention", () => ({
    purgeExecutionLogs: (...a: unknown[]) => purgeLogs(...a),
    deleteOldExecutions: (...a: unknown[]) => deleteRuns(...a),
}));
vi.mock("@/services/trash/trash-service", () => ({ cleanTrash: (...a: unknown[]) => trashClean(...a) }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { getDataRetentionValues, updateDataRetentionSettings, runDataRetention } = await import(
    "@/services/system/data-retention-service"
);

function stored(entries: Record<string, string>) {
    prismaMock.systemSetting.findMany.mockResolvedValue(
        Object.entries(entries).map(([key, value]) => ({ key, value, description: null, updatedAt: new Date() }))
    );
}

describe("Data retention settings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auditClean.mockResolvedValue({ count: 0 });
        healthClean.mockResolvedValue(0);
        notificationClean.mockResolvedValue(0);
        snapshotClean.mockResolvedValue(0);
        purgeLogs.mockResolvedValue(0);
        deleteRuns.mockResolvedValue(0);
    });

    it("uses the defaults on an instance that never changed them", async () => {
        stored({});

        const values = await getDataRetentionValues();

        expect(values).toEqual({
            executionLogs: 365,
            executionHistory: 0,
            auditLog: 90,
            notificationHistory: 90,
            storageUsage: 90,
            healthChecks: 2,
            deletedItems: 30,
        });
    });

    it("keeps values saved before the settings moved into their own card", async () => {
        stored({ "audit.retentionDays": "365", "storage.snapshotRetentionDays": "30", "notification.logRetentionDays": "14" });

        const values = await getDataRetentionValues();

        expect(values).toMatchObject({ auditLog: 365, storageUsage: 30, notificationHistory: 14 });
    });

    it("falls back to the default for a value that is not a whole number of days", async () => {
        stored({ "execution.logRetentionDays": "soon", "audit.retentionDays": "-5" });

        const values = await getDataRetentionValues();

        expect(values).toMatchObject({ executionLogs: 365, auditLog: 90 });
    });

    it("saves the offered values of the save bar under the keys of their settings, in one transaction", async () => {
        await updateDataRetentionSettings({ executionHistory: 365, auditLog: 730 });

        expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { key: "execution.retentionDays" },
            update: { value: "365" },
        }));
        expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { key: "audit.retentionDays" },
            update: { value: "730" },
        }));
        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it("saves nothing when one setting is unknown or one value is not offered", async () => {
        await expect(updateDataRetentionSettings({ auditLog: 365, backups: 30 })).rejects.toBeInstanceOf(ValidationError);
        await expect(updateDataRetentionSettings({ auditLog: 365, healthChecks: 3650 })).rejects.toBeInstanceOf(ValidationError);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
});

describe("Data retention cleanup run", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auditClean.mockResolvedValue({ count: 4 });
        healthClean.mockResolvedValue(100);
        notificationClean.mockResolvedValue(2);
        snapshotClean.mockResolvedValue(7);
        purgeLogs.mockResolvedValue(50);
        deleteRuns.mockResolvedValue(0);
        trashClean.mockResolvedValue(3);
    });

    it("applies each configured period and skips the ones set to never", async () => {
        stored({ "execution.logRetentionDays": "30" });

        const result = await runDataRetention();

        expect(purgeLogs).toHaveBeenCalledWith(30);
        expect(deleteRuns).not.toHaveBeenCalled();
        expect(auditClean).toHaveBeenCalledWith(90);
        expect(notificationClean).toHaveBeenCalledWith(90);
        expect(snapshotClean).toHaveBeenCalledWith(90);
        expect(healthClean).toHaveBeenCalledWith(2);
        expect(trashClean).toHaveBeenCalledWith(30);
        expect(result).toEqual({
            executionHistory: null,
            executionLogs: 50,
            auditLog: 4,
            notificationHistory: 2,
            storageUsage: 7,
            healthChecks: 100,
            deletedItems: 3,
        });
    });

    it("deletes old runs before purging logs, so rows about to go are not rewritten first", async () => {
        stored({ "execution.retentionDays": "365" });
        const order: string[] = [];
        deleteRuns.mockImplementation(async () => { order.push("delete"); return 0; });
        purgeLogs.mockImplementation(async () => { order.push("purge"); return 0; });

        await runDataRetention();

        expect(order).toEqual(["delete", "purge"]);
    });

    it("keeps cleaning the other data when one cleanup fails", async () => {
        stored({});
        auditClean.mockRejectedValue(new Error("database is locked"));

        const result = await runDataRetention();

        expect(result.auditLog).toBeNull();
        expect(notificationClean).toHaveBeenCalled();
        expect(healthClean).toHaveBeenCalled();
        expect(result.healthChecks).toBe(100);
    });
});
