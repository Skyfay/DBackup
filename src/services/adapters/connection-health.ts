import prisma from "@/lib/prisma";

/**
 * How the health checks of a connection went over the last day, as the connection tables show
 * them: one bucket per hour, the share that passed and the response time of the newest that passed.
 */

/** One hour of health checks: all passed, one failed, the connection went offline, or none ran. */
export type HealthBucket = "ok" | "failed" | "offline" | "none";

export const HEALTH_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

/** What the checks of a connection of the last day came to. */
export interface CheckSummary {
    /** One bucket per hour of the last day, oldest first. */
    health: HealthBucket[];
    /** Share of passed health checks over the last day in percent, null when none ran. */
    checksPassed: number | null;
    /** Response time of the newest passed health check. */
    latencyMs: number | null;
}

/** What the health checks of one hour of the last day came to, the oldest hour 0. */
export interface HourOfChecks {
    hour: number;
    total: number;
    passed: number;
    offline: number;
}

/**
 * Turns the counts of each hour into the buckets the page shows. A failed check marks its hour even
 * when the others passed, because one failure is what a person looking for trouble wants to see,
 * and an offline one marks it over a failed one.
 */
export function bucketsOf(hours: readonly HourOfChecks[]): { health: HealthBucket[]; checksPassed: number | null } {
    const health: HealthBucket[] = Array.from({ length: HEALTH_HOURS }, () => "none");
    let passed = 0;
    let total = 0;
    for (const counts of hours) {
        if (counts.hour < 0 || counts.hour >= HEALTH_HOURS || counts.total === 0) continue;
        total += counts.total;
        passed += counts.passed;
        health[counts.hour] = counts.offline > 0 ? "offline" : counts.total > counts.passed + counts.offline ? "failed" : "ok";
    }
    return { health, checksPassed: total === 0 ? null : Math.round((passed / total) * 1000) / 10 };
}

/** Groups a day of health checks into hourly buckets, see `bucketsOf`. */
export function healthBuckets(
    checks: { status: string; createdAt: Date }[],
    now: Date,
): { health: HealthBucket[]; checksPassed: number | null } {
    const start = now.getTime() - HEALTH_HOURS * HOUR_MS;
    const hours = Array.from({ length: HEALTH_HOURS }, (_, hour): HourOfChecks => ({ hour, total: 0, passed: 0, offline: 0 }));
    for (const check of checks) {
        const offset = check.createdAt.getTime() - start;
        if (offset < 0 || offset > HEALTH_HOURS * HOUR_MS) continue;
        // A check at this very moment belongs to the newest hour, not to one after it.
        const counts = hours[Math.min(HEALTH_HOURS - 1, Math.floor(offset / HOUR_MS))];
        counts.total++;
        if (check.status === "ONLINE") counts.passed++;
        else if (check.status === "OFFLINE") counts.offline++;
    }
    return bucketsOf(hours);
}

/** A connection without checks, like one another tenant shares, whose checks stay with that tenant. */
export const noChecks = (): CheckSummary => ({ ...bucketsOf([]), latencyMs: null });

const count = (value: number | bigint | null) => Number(value ?? 0);

/**
 * The health checks of the last day of each connection as the page shows them: one bucket per
 * hour, the share that passed and the response time of the newest one that passed. Counted by
 * SQLite, since a check a minute is 1,440 rows a day for each connection, and All tenants of a
 * busy instance lists thousands of connections, whose rows all went through Prisma before.
 *
 * Raw SQL for that measured reason. It skips the tenant filter, so it only reads the checks of the
 * connections the client found, and only numbers. `createdAt` is stored in epoch milliseconds, as
 * Prisma writes every DateTime in SQLite.
 */
export async function checksOf(configIds: string[], now: Date): Promise<Map<string, CheckSummary>> {
    if (configIds.length === 0) return new Map();
    const start = now.getTime() - HEALTH_HOURS * HOUR_MS;
    const ids = JSON.stringify(configIds);
    const [hours, newest] = await Promise.all([
        prisma.$queryRaw<{ id: string; hour: number | bigint; total: number | bigint; passed: number | bigint | null; offline: number | bigint | null }[]>`
            SELECT h.adapterConfigId AS id,
                   CAST(MIN((h.createdAt - ${start}) / ${HOUR_MS}, ${HEALTH_HOURS - 1}) AS INTEGER) AS hour,
                   COUNT(*) AS total,
                   SUM(h.status = 'ONLINE') AS passed,
                   SUM(h.status = 'OFFLINE') AS offline
            FROM HealthCheckLog h
            WHERE h.adapterConfigId IN (SELECT value FROM json_each(${ids}))
              AND h.createdAt >= ${start} AND h.createdAt <= ${now.getTime()}
            GROUP BY h.adapterConfigId, hour`,
        prisma.$queryRaw<{ id: string; latencyMs: number | bigint | null }[]>`
            SELECT j.value AS id, (
                SELECT h.latencyMs FROM HealthCheckLog h
                WHERE h.adapterConfigId = j.value AND h.createdAt >= ${start} AND +h.status = 'ONLINE'
                ORDER BY h.createdAt DESC
                LIMIT 1
            ) AS latencyMs
            FROM json_each(${ids}) j`,
    ]);

    const byConfig = new Map<string, HourOfChecks[]>();
    for (const row of hours) {
        const list = byConfig.get(row.id) ?? [];
        list.push({ hour: count(row.hour), total: count(row.total), passed: count(row.passed), offline: count(row.offline) });
        byConfig.set(row.id, list);
    }
    const latency = new Map(newest.map((row) => [row.id, row.latencyMs === null ? null : Number(row.latencyMs)]));
    return new Map(configIds.map((id) => [id, { ...bucketsOf(byConfig.get(id) ?? []), latencyMs: latency.get(id) ?? null }]));
}
