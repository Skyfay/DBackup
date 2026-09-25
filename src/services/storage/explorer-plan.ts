import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { readCron } from "@/lib/core/cron";
import { effectiveBackupTime } from "@/lib/core/backup-files";
import type { FileInfo } from "@/lib/core/interfaces";
import type { RetentionConfiguration } from "@/lib/core/retention";
import { RetentionService } from "@/services/backup/retention-service";
import type { ExplorerFile, MissedDay } from "./explorer-types";

/**
 * What the schedules of the jobs plan and what they missed, for the timeline of the Backups tab.
 * Plain functions over schedules, runs and files, so the rules can be tested without a database.
 */

const DAY_MS = 86_400_000;
/** How many days after today the timeline plans. */
export const PLAN_DAYS = 7;
/** How far back missed runs are looked for. */
export const MISSED_DAYS = 90;
/** A run due less than this long ago is not missed yet, the queue may still start it. */
export const GRACE_MS = 15 * 60_000;
/** Planned runs of one job at most, one every five minutes over the plan and the rest of today. */
export const MAX_PLANNED = (PLAN_DAYS + 1) * 288;
/** Runs of one missed day counted at most, one every five minutes. */
const MAX_DAY_RUNS = 288;
const PLANNED = "planned:";

/** The start times of a schedule after `from` up to `until`, soonest first. None for a schedule it cannot read. */
export function runsBetween(expression: string, timezone: string, from: number, until: number, cap = MAX_PLANNED): { times: number[]; truncated: boolean } {
    const cron = readCron(expression, timezone);
    if (!cron) return { times: [], truncated: false };
    const times: number[] = [];
    let cursor = new Date(from);
    for (;;) {
        const next = cron.nextRun(cursor);
        if (!next || next.getTime() > until) return { times, truncated: false };
        if (times.length === cap) return { times, truncated: true };
        times.push(next.getTime());
        cursor = next;
    }
}

function nextDate(day: string): string {
    const [year, month, date] = day.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

/**
 * The days of the scheduler's time zone between `from` and `now` whose schedule had runs due and on
 * which no run of the job started at all, by the schedule or by hand. A day on which one run started
 * is kept, since the timeline tells days apart, not runs.
 */
export function missedDays(expression: string, timezone: string, from: number, now: number, started: number[]): MissedDay[] {
    const cron = readCron(expression, timezone);
    if (!cron || from >= now) return [];
    const missed: MissedDay[] = [];
    let day = formatInTimeZone(from, timezone, "yyyy-MM-dd");
    for (let guard = 0; guard <= MISSED_DAYS + 1; guard++) {
        const start = fromZonedTime(`${day}T00:00:00`, timezone).getTime();
        if (start >= now) break;
        const following = nextDate(day);
        const end = fromZonedTime(`${following}T00:00:00`, timezone).getTime();
        // The job may have changed at `from`, so the first day only counts from there.
        const opens = Math.max(start, from);
        if (!started.some((time) => time >= start && time < end)) {
            const due: number[] = [];
            let cursor = new Date(opens - 1);
            while (due.length < MAX_DAY_RUNS) {
                const next = cron.nextRun(cursor);
                if (!next || next.getTime() >= end || next.getTime() + GRACE_MS > now) break;
                due.push(next.getTime());
                cursor = next;
            }
            if (due.length > 0) missed.push({ at: new Date(due[0]).toISOString(), runs: due.length });
        }
        day = following;
    }
    return missed;
}

/** Which planned runs start a new chain, the way the chain planner decides: when there is none, or once it is `fullEveryDays` old. */
export function markFulls(times: number[], chainStartedAt: number | null, fullEveryDays: number): boolean[] {
    let start = chainStartedAt;
    return times.map((time) => {
        if (start === null || (time - start) / DAY_MS >= fullEveryDays) {
            start = time;
            return true;
        }
        return false;
    });
}

/** A backup the way the retention of the runner sees it. */
export function toFileInfo(file: ExplorerFile): FileInfo {
    return {
        name: file.name,
        path: file.path,
        size: file.size,
        lastModified: new Date(file.lastModified),
        backupTimestamp: file.createdAt ? new Date(file.createdAt) : undefined,
        locked: file.locked,
        chainId: file.chain?.id,
    };
}

/** A policy stored as JSON, NONE when it cannot be read, like the runner does. */
export function readPolicy(config: string | null | undefined): RetentionConfiguration | null {
    if (!config || config.trim() === "" || config.trim() === "{}") return null;
    try {
        return JSON.parse(config) as RetentionConfiguration;
    } catch {
        return { mode: "NONE" };
    }
}

/**
 * What the retention of one destination removes after the planned runs of each day, told on the
 * last run of that day. The backups there are judged by the retention of the runner with the runs
 * of a day added, so a chain goes as a whole and a locked backup stays, like after real runs. A day
 * at a time rather than a run, since an hourly job would judge hundreds of backups for every run,
 * and what goes by the end of a day is the same. Null for a run that removes nothing.
 */
export function simulateRetention(
    files: FileInfo[],
    runs: { at: number; full?: boolean }[],
    policy: RetentionConfiguration,
    timezone: string,
    chains: boolean
): ({ count: number; oldest: number } | null)[] {
    if (policy.mode === "NONE") return runs.map(() => null);
    let current = [...files];
    // The chain the next incremental adds to is the one of the newest backup there.
    const newest = [...files].sort((a, b) => effectiveBackupTime(b).getTime() - effectiveBackupTime(a).getTime())[0];
    let chain = newest?.chainId;
    const dayOf = (time: number) => formatInTimeZone(time, timezone, "yyyy-MM-dd");
    return runs.map((run, index) => {
        if (chains && (run.full || !chain)) chain = `${PLANNED}chain-${index}`;
        current.push({
            name: `${PLANNED}${index}`,
            path: `${PLANNED}${index}`,
            size: 0,
            lastModified: new Date(run.at),
            backupTimestamp: new Date(run.at),
            chainId: chains ? chain : undefined,
        });
        const next = runs[index + 1];
        if (next && dayOf(next.at) === dayOf(run.at)) return null;
        const removed = RetentionService.calculateRetention(current, policy, timezone).delete;
        const gone = new Set(removed.map((file) => file.path));
        current = current.filter((file) => !gone.has(file.path));
        const real = removed.filter((file) => !file.path.startsWith(PLANNED));
        if (real.length === 0) return null;
        return { count: real.length, oldest: Math.min(...real.map((file) => effectiveBackupTime(file).getTime())) };
    });
}
