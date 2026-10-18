import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { WHOLE_JOB_RUNS } from "@/services/history/whole-runs";

vi.mock("@/lib/tenant/current", () => ({ currentTenantId: async () => "acme" }));
vi.mock("@/services/sharing/provided", () => ({ providedTo: async () => [] }));

const { scopeOf } = await import("@/services/history/run-detail-service");
const { getHistoryAttention } = await import("@/services/history/history-attention");
const { runRow } = await import("@/services/history/run-row");
const { runAgainLabel } = await import("@/components/dashboard/history/run-actions");

describe("the runs an integrity check is compared with", () => {
    it("are the checks of its own tenant, since All tenants reads the checks of every tenant", () => {
        expect(scopeOf({ jobId: null, type: "IntegrityCheck", tenantId: "acme" })).toEqual({ type: "IntegrityCheck", jobId: null, tenantId: "acme" });
        expect(scopeOf({ jobId: null, type: "Verification", tenantId: "shop" })).toEqual({ type: "Verification", jobId: null, tenantId: "shop" });
        expect(scopeOf({ jobId: "j1", type: "Backup", tenantId: "acme" })).toEqual({ jobId: "j1" });
    });
});

describe("the dot of the History tab", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // groupBy is too generic for the mock types, so it is reached as a plain mock.
        (prismaMock.execution.groupBy as unknown as Mock).mockResolvedValue([{ jobId: "j1", _max: { startedAt: new Date("2026-10-15T10:00:00Z") } }]);
        (prismaMock.notificationLog.groupBy as unknown as Mock).mockResolvedValue([]);
        prismaMock.execution.findMany.mockResolvedValue([] as never);
    });

    it("follows the newest run of each job as a whole, never a run of some of its databases a customer started", async () => {
        await getHistoryAttention();

        const newest = (prismaMock.execution.groupBy as unknown as Mock).mock.calls[0][0] as { where: { AND?: unknown[] } };
        const failed = prismaMock.execution.findMany.mock.calls[0][0] as { where: { AND?: unknown[] } };
        expect(newest.where.AND).toEqual([WHOLE_JOB_RUNS]);
        expect(failed.where.AND).toEqual([WHOLE_JOB_RUNS]);
    });
});

describe("Run again on a run of some databases", () => {
    const record = {
        id: "r1", jobId: "j1", type: "Backup", status: "Success", startedAt: new Date(), endedAt: new Date(), size: null, path: null,
        triggerType: "Manual", triggerLabel: "Acme · Sara", job: { name: "Nightly", source: null, sources: [] },
    };

    it("says that it runs the whole job, which backs up every database, not only the ones of the run", () => {
        const single = runRow({ ...record, metadata: JSON.stringify({ onlyDatabases: ["shop"] }) }, null, null);
        const whole = runRow({ ...record, metadata: null }, null, null);

        expect(single.someDatabases).toBe(true);
        expect(runAgainLabel(single)).toBe("Run the job");
        expect(whole.someDatabases).toBeUndefined();
        expect(runAgainLabel(whole)).toBe("Run again");
    });
});
