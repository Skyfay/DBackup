import prisma from "@/lib/prisma";

export type HealthCheckStatus = "ONLINE" | "DEGRADED" | "OFFLINE";

export interface HealthCheck {
    id: string;
    status: HealthCheckStatus;
    latencyMs: number;
    createdAt: string;
    error: string | null;
}

export interface HealthHistory {
    /** The latest checks, newest first. */
    history: HealthCheck[];
    stats: {
        /** Share of the listed checks that passed, in percent. */
        uptime: number;
        /** Mean and slowest response time of the listed checks that passed, 0 when none did. */
        avgLatency: number;
        maxLatency: number;
        totalChecks: number;
    };
    /** When the status of the newest check began, also when that lies before the listed checks. */
    since: string | null;
    /** The newest check that passed, however long ago. */
    lastPassedAt: string | null;
}

/**
 * The latest health checks of one connection and how they went. `since` and `lastPassedAt`
 * look past `limit`, so a connection that has been offline all day still says so.
 */
export async function getHealthHistory(adapterConfigId: string, options: { limit: number; from?: Date }): Promise<HealthHistory> {
    const rows = await prisma.healthCheckLog.findMany({
        where: { adapterConfigId, ...(options.from ? { createdAt: { gte: options.from } } : {}) },
        orderBy: { createdAt: "desc" },
        take: options.limit,
        select: { id: true, status: true, latencyMs: true, createdAt: true, error: true },
    });

    const newest = rows[0];
    const [since, lastPassedAt] = newest
        ? await Promise.all([
              statusSince(adapterConfigId, newest.status),
              newest.status === "ONLINE" ? newest.createdAt : lastPassed(adapterConfigId),
          ])
        : [null, null];

    // A failed check reports how long it waited, not how fast the connection answered.
    const passed = rows.filter((row) => row.status === "ONLINE").map((row) => row.latencyMs);
    return {
        history: rows.map((row) => ({ ...row, status: row.status as HealthCheckStatus, createdAt: row.createdAt.toISOString() })),
        stats: {
            uptime: rows.length > 0 ? Math.round((passed.length / rows.length) * 10000) / 100 : 0,
            avgLatency: passed.length > 0 ? Math.round(passed.reduce((sum, latency) => sum + latency, 0) / passed.length) : 0,
            maxLatency: passed.length > 0 ? Math.max(...passed) : 0,
            totalChecks: rows.length,
        },
        since: since?.toISOString() ?? null,
        lastPassedAt: lastPassedAt?.toISOString() ?? null,
    };
}

/** The first check of the unbroken run of checks with this status that ends with the newest one. */
async function statusSince(adapterConfigId: string, status: string): Promise<Date | null> {
    const before = await prisma.healthCheckLog.findFirst({
        where: { adapterConfigId, status: { not: status } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
    });
    const first = await prisma.healthCheckLog.findFirst({
        where: { adapterConfigId, status, ...(before ? { createdAt: { gt: before.createdAt } } : {}) },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
    });
    return first?.createdAt ?? null;
}

async function lastPassed(adapterConfigId: string): Promise<Date | null> {
    const check = await prisma.healthCheckLog.findFirst({
        where: { adapterConfigId, status: "ONLINE" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
    });
    return check?.createdAt ?? null;
}
