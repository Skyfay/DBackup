// @vitest-environment node
/**
 * A follower makes no progress of its own, so the watchdog leaves it out of its sweep. Without the
 * run it follows, gone with a deleted tenant or ended while the write of the follower failed, it
 * would stay Running forever. The watchdog ends such a follower once the grace has passed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { endOrphanedFollowers, FOLLOWS_KEY, LEADING_RUNS, leaderOf, ORPHAN_GRACE_MS } from "@/lib/execution/follower-runs";
import { sweepStuckExecutions } from "@/services/system/stuck-execution-service";

vi.mock("@/lib/execution/queue-manager", () => ({ processQueue: vi.fn().mockResolvedValue(undefined) }));

const NOW = Date.parse("2026-10-17T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000);

interface Row { id: string; status: string; metadata: string | null; startedAt: Date; endedAt: Date | null; logs: string }

/** The executions table in memory: the reads filter it, the writes change it. */
let rows: Row[];

const follower = (id: string, leaderId: string, startedMinutesAgo = 60, status = "Running"): Row => ({
    id, status, metadata: JSON.stringify({ [FOLLOWS_KEY]: leaderId, stage: "Restoring" }), startedAt: minutesAgo(startedMinutesAgo), endedAt: null, logs: "[]",
});
const leader = (id: string, status: string, endedMinutesAgo: number | null): Row => ({
    id, status, metadata: null, startedAt: minutesAgo(120), endedAt: endedMinutesAgo === null ? null : minutesAgo(endedMinutesAgo), logs: "[]",
});

const statusOf = (id: string) => rows.find((row) => row.id === id)?.status;
const lastLine = (id: string) => (JSON.parse(rows.find((row) => row.id === id)!.logs) as { message: string }[]).pop()?.message;

beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    prismaMock.execution.findMany.mockImplementation((async ({ where }: { where: { id?: { in: string[] }; status?: { in: string[] } | string; metadata?: { contains: string } } }) => rows.filter((row) => {
        if (where.id && !where.id.in.includes(row.id)) return false;
        if (typeof where.status === "string" && row.status !== where.status) return false;
        if (where.status && typeof where.status === "object" && !where.status.in.includes(row.status)) return false;
        if (where.metadata && !(row.metadata ?? "").includes(where.metadata.contains)) return false;
        return true;
    })) as never);
    prismaMock.execution.updateMany.mockImplementation((async ({ where, data }: { where: { id: string; status: { in: string[] } }; data: Partial<Row> }) => {
        const row = rows.find((entry) => entry.id === where.id && where.status.in.includes(entry.status));
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
    }) as never);
});

describe("followers whose run is gone or over", () => {
    it("fails a follower whose run was deleted with its tenant", async () => {
        rows = [follower("provider-run", "deleted-customer-run")];

        expect(await endOrphanedFollowers(NOW)).toBe(1);

        expect(statusOf("provider-run")).toBe("Failed");
        expect(lastLine("provider-run")).toBe("The run stopped before it finished.");
    });

    it("ends a follower its run ended without like that run, a cancelled one as cancelled", async () => {
        rows = [
            leader("customer-run", "Success", 30), follower("provider-run", "customer-run"),
            leader("backup-run", "Cancelled", 30), follower("customer-backup", "backup-run", 60, "Pending"),
        ];

        expect(await endOrphanedFollowers(NOW)).toBe(2);

        expect(statusOf("provider-run")).toBe("Success");
        expect(statusOf("customer-backup")).toBe("Cancelled");
        // The run that ended stays as it was.
        expect(statusOf("customer-run")).toBe("Success");
    });

    it("leaves a follower whose run still waits or runs", async () => {
        rows = [leader("backup-run", "Running", null), follower("customer-backup", "backup-run", 600), leader("queued", "Pending", null), follower("waits", "queued", 600, "Pending")];

        expect(await endOrphanedFollowers(NOW)).toBe(0);

        expect(statusOf("customer-backup")).toBe("Running");
        expect(statusOf("waits")).toBe("Pending");
    });

    it("gives a follower the grace first, while its run is queued right after it or still writes it", async () => {
        const fresh = ORPHAN_GRACE_MS / 60_000 - 1;
        rows = [
            follower("customer-backup", "not-queued-yet", fresh, "Pending"),
            leader("customer-run", "Failed", fresh), follower("provider-run", "customer-run"),
        ];

        expect(await endOrphanedFollowers(NOW)).toBe(0);

        expect(statusOf("customer-backup")).toBe("Pending");
        expect(statusOf("provider-run")).toBe("Running");
    });

    it("never include a run whose destination or database is called followsRun, which the queue and the watchdog keep", async () => {
        const own: Row = {
            id: "own-run", status: "Running", startedAt: minutesAgo(60), endedAt: null, logs: "[]",
            metadata: JSON.stringify({ destinations: [{ name: FOLLOWS_KEY }], onlyDatabases: [FOLLOWS_KEY], stage: "Uploading" }),
        };
        const mark = (LEADING_RUNS.OR as { NOT?: { metadata: { contains: string } } }[])[1].NOT!.metadata.contains;

        expect(own.metadata!.includes(mark)).toBe(false);
        expect(follower("provider-run", "run-1").metadata!.includes(mark)).toBe(true);
        expect(leaderOf(own.metadata)).toBeNull();

        rows = [own];
        expect(await endOrphanedFollowers(NOW)).toBe(0);
        expect(statusOf("own-run")).toBe("Running");
    });

    it("are ended by the stuck run watchdog, which leaves them out of its own sweep", async () => {
        vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
        try {
            prismaMock.systemSetting.findUnique.mockResolvedValue(null);
            rows = [follower("provider-run", "deleted-customer-run")];

            const sweep = await sweepStuckExecutions();

            expect(statusOf("provider-run")).toBe("Failed");
            // A follower holds no slot of the queue, so it is no stuck run either.
            expect(sweep).toEqual({ checked: 0, cancelled: 0 });
        } finally {
            vi.useRealTimers();
        }
    });
});
