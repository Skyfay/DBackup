import { describe, it, expect, beforeEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { getHealthHistory } from "@/services/adapters/health-history";

const at = (minute: number) => new Date(`2026-09-22T13:${String(minute).padStart(2, "0")}:00.000Z`);
const row = (minute: number, status: string, latencyMs: number, error: string | null = null) => ({
    id: `c${minute}`,
    status,
    latencyMs,
    error,
    createdAt: at(minute),
});

describe("getHealthHistory", () => {
    beforeEach(() => {
        prismaMock.healthCheckLog.findMany.mockResolvedValue([]);
        prismaMock.healthCheckLog.findFirst.mockResolvedValue(null);
    });

    it("averages only the checks that passed, since a failed one reports how long it waited", async () => {
        prismaMock.healthCheckLog.findMany.mockResolvedValue([
            row(58, "OFFLINE", 5000, "Timeout after 5000 ms"),
            row(57, "ONLINE", 40),
            row(56, "ONLINE", 20),
        ] as never);

        const { stats } = await getHealthHistory("pg", { limit: 60 });

        expect(stats).toEqual({ uptime: 66.67, avgLatency: 30, maxLatency: 40, totalChecks: 3 });
    });

    it("finds when the current status began, also before the listed checks", async () => {
        prismaMock.healthCheckLog.findMany.mockResolvedValue([row(58, "ONLINE", 30)] as never);
        prismaMock.healthCheckLog.findFirst
            // The newest check with another status.
            .mockResolvedValueOnce({ createdAt: at(10) } as never)
            // The first ONLINE check after it.
            .mockResolvedValueOnce({ createdAt: at(11) } as never);

        const history = await getHealthHistory("pg", { limit: 1 });

        expect(history.since).toBe("2026-09-22T13:11:00.000Z");
        expect(history.lastPassedAt).toBe("2026-09-22T13:58:00.000Z");
        expect(prismaMock.healthCheckLog.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: { adapterConfigId: "pg", status: { not: "ONLINE" } },
            orderBy: { createdAt: "desc" },
        }));
    });

    it("looks up the last passed check of a connection that is failing now", async () => {
        prismaMock.healthCheckLog.findMany.mockResolvedValue([row(58, "OFFLINE", 5000, "refused")] as never);
        prismaMock.healthCheckLog.findFirst.mockImplementation((async (args: { where: { status: unknown }; orderBy: { createdAt: string } }) => {
            if (args.where.status === "ONLINE" && args.orderBy.createdAt === "desc") return { createdAt: at(20) };
            return null;
        }) as never);

        const history = await getHealthHistory("sftp", { limit: 60 });

        expect(history.lastPassedAt).toBe("2026-09-22T13:20:00.000Z");
    });

    it("answers with empty values for a connection that was never checked", async () => {
        const history = await getHealthHistory("new", { limit: 60 });

        expect(history).toEqual({
            history: [],
            stats: { uptime: 0, avgLatency: 0, maxLatency: 0, totalChecks: 0 },
            since: null,
            lastPassedAt: null,
        });
        expect(prismaMock.healthCheckLog.findFirst).not.toHaveBeenCalled();
    });
});
