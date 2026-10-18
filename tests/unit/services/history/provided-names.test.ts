import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { runAsTenant } from "@/lib/tenant/context";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { getHistoryAttention } from "@/services/history/history-attention";
import { getRunDetail } from "@/services/history/run-detail-service";
import { record } from "./run-fixtures";

/**
 * Acme Hosting shares its NAS and its Slack channel with Globex. Both belong to Acme, so the scope
 * of Globex never finds them, and History asks for them by their ids.
 */
const provided = vi.hoisted(() => ({
    providedTo: vi.fn(async (tenantId: string, filter: { kind?: string; ids?: readonly string[] }) => {
        if (tenantId !== "globex") return [];
        const shared = [
            { id: "acme-nas", name: "Acme NAS", type: "storage", adapterId: "s3", kind: "destination" },
            { id: "acme-slack", name: "Acme Slack", type: "notification", adapterId: "slack", kind: "channel" },
        ];
        return shared.filter((connection) => (!filter.kind || connection.kind === filter.kind) && (!filter.ids || filter.ids.includes(connection.id)));
    }),
}));
vi.mock("@/services/sharing/provided", () => provided);
vi.mock("@/services/storage/verification-service", () => ({ checksNatively: (adapterId: string) => adapterId === "s3" }));

const mocked = (fn: unknown) => fn as Mock;

beforeEach(() => {
    vi.clearAllMocks();
    invalidateDashboardCache();
    prismaMock.execution.findMany.mockReset();
    prismaMock.execution.findFirst.mockReset();
    prismaMock.notificationLog.findMany.mockReset();
    prismaMock.adapterConfig.findMany.mockReset();
    prismaMock.execution.findMany.mockResolvedValue([] as never);
    prismaMock.execution.findFirst.mockResolvedValue(null);
    prismaMock.notificationLog.findMany.mockResolvedValue([] as never);
    // The filtered client finds only the own connections of Globex.
    prismaMock.adapterConfig.findMany.mockResolvedValue([] as never);
    // No jobs, so no run to look at.
    prismaMock.job.findMany.mockResolvedValue([] as never);
});

describe("the dot of History for a customer", () => {
    it("names a shared channel whose last message failed, by its name of now", async () => {
        const newest = new Date("2026-09-30T03:00:00.000Z");
        mocked(prismaMock.notificationLog.groupBy).mockResolvedValue([{ channelId: "acme-slack", _max: { sentAt: newest } }, { channelId: "globex-mail", _max: { sentAt: newest } }] as never);
        prismaMock.notificationLog.findMany.mockResolvedValue([{ channelId: "acme-slack" }, { channelId: "globex-mail" }] as never);
        prismaMock.adapterConfig.findMany.mockResolvedValue([{ id: "globex-mail", name: "Globex mail" }] as never);

        const attention = await runAsTenant("globex", () => getHistoryAttention());

        expect(attention.notifications).toEqual({ tone: "destructive", note: "Acme Slack and Globex mail failed to send their last message" });
        expect(provided.providedTo).toHaveBeenCalledWith("globex", { kind: "channel", ids: ["acme-slack"] });
    });

    it("says nothing of a channel that is no longer shared with it", async () => {
        const newest = new Date("2026-09-30T03:00:00.000Z");
        mocked(prismaMock.notificationLog.groupBy).mockResolvedValue([{ channelId: "acme-slack", _max: { sentAt: newest } }] as never);
        prismaMock.notificationLog.findMany.mockResolvedValue([{ channelId: "acme-slack" }] as never);

        const attention = await runAsTenant("initech", () => getHistoryAttention());

        expect(attention.notifications).toBeUndefined();
    });
});

describe("the page of a check run of a customer", () => {
    it("names a destination another tenant shares with it and knows that it checks copies by itself", async () => {
        prismaMock.execution.findUnique.mockResolvedValue({
            ...record({ id: "check-1", jobId: null, type: "Verification", status: "Success", tenantId: "globex", job: null } as never),
            metadata: JSON.stringify({ copies: [{ destinationId: "acme-nas", file: "Shop/a.tar", state: "passed", method: "native", size: 1024 }] }),
            logs: "[]",
            logsPurgedAt: null,
            backupType: null,
            job: null,
        } as never);

        const run = (await runAsTenant("globex", () => getRunDetail("check-1", Date.parse("2026-09-27T05:00:00.000Z"))))!;

        expect(run.checks?.destinations).toMatchObject([{ id: "acme-nas", name: "Acme NAS", adapterId: "s3", native: true, passed: 1 }]);
        expect(provided.providedTo).toHaveBeenCalledWith("globex", { kind: "destination", ids: ["acme-nas"] });
    });
});
