import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { getRunDetail } from "@/services/history/run-detail-service";
import { offsiteLog, record } from "./run-fixtures";

const JOB = {
    id: "job-offsite",
    name: "Shop offsite",
    source: { id: "src-1", name: "Shop cluster", adapterId: "postgres" },
    sources: [],
    destinations: [{ configId: "nas", config: { name: "NAS Backups", adapterId: "sftp" } }, { configId: "drive", config: { name: "Google Drive", adapterId: "google-drive" } }],
};

function detailRecord(overrides: Record<string, unknown> = {}) {
    return {
        ...record({ status: "Partial" }),
        metadata: JSON.stringify({ names: ["shop"], destinations: [
            { configId: "nas", name: "NAS Backups", adapterId: "sftp", status: "success" },
            { configId: "drive", name: "Google Drive", adapterId: "google-drive", status: "failed", error: "403 quota" },
        ] }),
        logs: JSON.stringify(offsiteLog),
        logsPurgedAt: null,
        backupType: null,
        job: JOB,
        ...overrides,
    };
}

beforeEach(() => {
    invalidateDashboardCache();
    prismaMock.execution.findMany.mockReset();
    prismaMock.execution.findFirst.mockReset();
    prismaMock.notificationLog.findMany.mockReset();
    prismaMock.execution.findMany.mockResolvedValue([] as never);
    prismaMock.execution.findFirst.mockResolvedValue(null);
    prismaMock.notificationLog.findMany.mockResolvedValue([] as never);
});

describe("getRunDetail", () => {
    it("is null for a run that does not exist", async () => {
        prismaMock.execution.findUnique.mockResolvedValue(null);
        expect(await getRunDetail("nope")).toBeNull();
    });

    it("gives a finished run its steps, what to look at, its copies and its notifications", async () => {
        prismaMock.execution.findUnique.mockResolvedValue(detailRecord() as never);
        prismaMock.notificationLog.findMany.mockResolvedValue([
            { id: "n1", channelId: "tg", channelName: "Telegram Manu", adapterId: "telegram", status: "Failed", error: "403 Forbidden: bot was blocked by the user", title: "Backup partial", sentAt: new Date("2026-09-27T04:07:14.000Z") },
        ] as never);

        const run = (await getRunDetail("run-1", Date.parse("2026-09-27T05:00:00.000Z")))!;

        expect(run).toMatchObject({ name: "Shop offsite", status: "Partial", note: "Google Drive failed", databases: ["shop"], job: { id: "job-offsite", name: "Shop offsite" } });
        expect(run.problems.map((problem) => problem.title)).toEqual(["Google Drive is full", "Telegram blocked the bot", "Circular foreign keys in orders"]);
        expect(run.uploads.map((upload) => [upload.name, upload.state])).toEqual([["NAS Backups", "done"], ["Google Drive", "failed"]]);
        expect(run.steps.find((step) => step.name === "Sending Notifications")?.state).toBe("failed");
        expect(run.notifications).toHaveLength(1);
    });

    it("shows the uploads of a live backup, the runs around it and who waits for it", async () => {
        prismaMock.execution.findUnique.mockResolvedValue(detailRecord({
            status: "Running",
            endedAt: null,
            metadata: JSON.stringify({ stage: "Uploading", progress: 70, uploads: [{ configId: "nas", name: "NAS Backups", adapterId: "sftp", state: "uploading", bytes: 39, total: 61 }] }),
        }) as never);
        prismaMock.execution.findFirst
            .mockResolvedValueOnce({ id: "before", startedAt: new Date("2026-09-26T04:00:00.000Z"), endedAt: new Date("2026-09-26T04:07:00.000Z"), status: "Success", size: BigInt(10), triggerType: "Scheduler", triggerLabel: null } as never)
            .mockResolvedValueOnce(null);
        prismaMock.execution.findMany.mockImplementation(((args: { where?: { status?: string } }) =>
            Promise.resolve(args.where?.status === "Pending" ? [record({ id: "waiting", status: "Pending", triggerType: "Manual", triggerLabel: "Manu" })] : [])) as never);

        const run = (await getRunDetail("run-1"))!;

        expect(run.live).toMatchObject({ stage: "Uploading", percent: 70 });
        expect(run.uploads).toEqual([expect.objectContaining({ name: "NAS Backups", state: "uploading", bytes: 39, total: 61 })]);
        expect(run.previous).toMatchObject({ id: "before", status: "Success", durationMs: 420_000 });
        expect(run.next).toBeNull();
        expect(run.queue).toEqual([{ id: "waiting", name: "Shop offsite", starter: { key: "manual:Manu", kind: "manual", label: "Manu" } }]);
    });
});
