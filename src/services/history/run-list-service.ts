import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { cached } from "@/services/dashboard/cache";
import { extractLastError } from "@/services/dashboard/health";
import { describeProblem } from "./known-problems";
import { rawOf, subjectOf } from "./run-problems";
import { runRow, starterOf, type RunRecord } from "./run-row";
import { median } from "./run-steps";
import type { RunFacets, RunJobOption, RunRow, RunStarterOption, RunStats } from "./run-types";

/**
 * The runs of the History page: one page of them with the filters, the counts beside each filter,
 * the options of the filters and the numbers above the list. Backups, restores and the system
 * tasks are one list, told apart by their type.
 */

export interface RunQuery {
    page?: number;
    pageSize?: number;
    types?: string[];
    statuses?: string[];
    jobIds?: string[];
    /** Who started them, as `starterOf` keys them. */
    starters?: string[];
    search?: string;
}

export const RUN_MAX_PAGE_SIZE = 100;
const USUAL_TTL_MS = 5 * 60 * 1000;
const NOTE_TTL_MS = 10 * 60 * 1000;
const STATS_TTL_MS = 10 * 1000;
const DAY_MS = 86_400_000;

export const RUN_SELECT = {
    id: true,
    jobId: true,
    type: true,
    status: true,
    startedAt: true,
    endedAt: true,
    size: true,
    path: true,
    metadata: true,
    triggerType: true,
    triggerLabel: true,
    job: {
        select: {
            name: true,
            source: { select: { adapterId: true } },
            sources: { select: { config: { select: { adapterId: true } } }, orderBy: { priority: "asc" }, take: 1 },
        },
    },
} satisfies Prisma.ExecutionSelect;

function starterWhere(key: string): Prisma.ExecutionWhereInput {
    if (key === "schedule") return { triggerType: "Scheduler" };
    if (key === "none") return { triggerType: null };
    const split = key.indexOf(":");
    const kind = key.slice(0, split);
    const label = key.slice(split + 1);
    const triggerType = kind === "api" ? "Api" : "Manual";
    return label ? { triggerType, triggerLabel: label } : { triggerType, OR: [{ triggerLabel: null }, { triggerLabel: "" }] };
}

function clean(values: string[] | undefined): string[] {
    return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

/** The `where` of a query. A filter left out by `omit` counts beside its own options. */
export function buildRunWhere(query: RunQuery, omit?: "types" | "statuses" | "jobIds" | "starters"): Prisma.ExecutionWhereInput {
    const and: Prisma.ExecutionWhereInput[] = [];
    const types = omit === "types" ? [] : clean(query.types);
    if (types.length > 0) and.push({ type: { in: types } });
    const statuses = omit === "statuses" ? [] : clean(query.statuses);
    if (statuses.length > 0) and.push({ status: { in: statuses } });
    const jobIds = omit === "jobIds" ? [] : clean(query.jobIds);
    if (jobIds.length > 0) and.push({ jobId: { in: jobIds } });
    const starters = omit === "starters" ? [] : clean(query.starters);
    if (starters.length > 0) and.push({ OR: starters.map(starterWhere) });
    const search = query.search?.trim();
    if (search) and.push({ OR: [{ job: { is: { name: { contains: search } } } }, { type: { contains: search } }, { path: { contains: search } }] });
    return and.length > 0 ? { AND: and } : {};
}

/** How long a run of a job usually takes, the median of its last 10 successful runs. */
export function usualOf(jobId: string): Promise<number | null> {
    return cached(`run-usual:${jobId}`, USUAL_TTL_MS, async () => {
        const runs = await prisma.execution.findMany({
            where: { jobId, status: "Success", endedAt: { not: null } },
            orderBy: { startedAt: "desc" },
            take: 10,
            select: { startedAt: true, endedAt: true },
        });
        return median(runs.map((run) => run.endedAt!.getTime() - run.startedAt.getTime()).filter((ms) => ms > 0));
    });
}

/** The error of a finished run in a few words, kept for a while since a finished log never changes. */
function noteOf(id: string): Promise<string | null> {
    return cached(`run-note:${id}`, NOTE_TTL_MS, async () => {
        const execution = await prisma.execution.findUnique({ where: { id }, select: { logs: true } });
        const line = extractLastError(execution?.logs);
        if (!line) return null;
        const { subject, text } = subjectOf(line);
        const raw = rawOf(text);
        const described = describeProblem(raw, "error", { subject, step: "", jobName: null, subjectKind: null });
        // A known message reads better as its title, an unknown one stays as the server wrote it.
        return described.help ? described.title : raw;
    }, { survivesInvalidation: true });
}

export async function toRows(records: RunRecord[]): Promise<RunRow[]> {
    const jobIds = [...new Set(records.filter((record) => record.type === "Backup" && record.jobId).map((record) => record.jobId!))];
    const usual = new Map(await Promise.all(jobIds.map(async (jobId) => [jobId, await usualOf(jobId)] as const)));
    const notes = new Map(await Promise.all(records.filter((record) => record.status === "Failed")
        .map(async (record) => [record.id, await noteOf(record.id)] as const)));
    return records.map((record) => runRow(record, record.jobId ? usual.get(record.jobId) ?? null : null, notes.get(record.id) ?? null));
}

/** One run as a row, for a panel that only names it. */
export async function getRunRow(id: string): Promise<RunRow | null> {
    const record = await prisma.execution.findUnique({ where: { id }, select: RUN_SELECT });
    return record ? (await toRows([record]))[0] : null;
}

export async function listRuns(query: RunQuery = {}): Promise<{ rows: RunRow[]; total: number; page: number; pageSize: number }> {
    const page = query.page && query.page > 0 ? Math.floor(query.page) : 1;
    const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize ?? 25)), RUN_MAX_PAGE_SIZE);
    const where = buildRunWhere(query);
    const [records, total] = await Promise.all([
        prisma.execution.findMany({ where, select: RUN_SELECT, orderBy: { startedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.execution.count({ where }),
    ]);
    return { rows: await toRows(records), total, page, pageSize };
}

function tally<T>(groups: T[], keyOf: (group: T) => string | null, countOf: (group: T) => number): Record<string, number> {
    const result: Record<string, number> = {};
    for (const group of groups) {
        const key = keyOf(group);
        if (key) result[key] = (result[key] ?? 0) + countOf(group);
    }
    return result;
}

/** How many runs each option leaves. A filter counts under every other filter, not its own. */
export async function getRunFacets(query: RunQuery): Promise<RunFacets> {
    const [type, status, job, starter] = await Promise.all([
        prisma.execution.groupBy({ by: ["type"], where: buildRunWhere(query, "types"), _count: { _all: true } }),
        prisma.execution.groupBy({ by: ["status"], where: buildRunWhere(query, "statuses"), _count: { _all: true } }),
        prisma.execution.groupBy({ by: ["jobId"], where: buildRunWhere(query, "jobIds"), _count: { _all: true } }),
        prisma.execution.groupBy({ by: ["triggerType", "triggerLabel"], where: buildRunWhere(query, "starters"), _count: { _all: true } }),
    ]);
    return {
        type: tally(type, (group) => group.type, (group) => group._count._all),
        status: tally(status, (group) => group.status, (group) => group._count._all),
        job: tally(job, (group) => group.jobId, (group) => group._count._all),
        starter: tally(starter, (group) => starterOf(group.triggerType, group.triggerLabel).key, (group) => group._count._all),
    };
}

const STARTER_ORDER: Record<RunStarterOption["group"], number> = { System: 0, "By hand": 1, "API keys": 2, Other: 3 };

/** The options of the Job and Started by filters: every job, the schedule, every person and every API key. */
export async function getRunOptions(): Promise<{ jobs: RunJobOption[]; starters: RunStarterOption[] }> {
    const [jobs, starters] = await Promise.all([
        prisma.job.findMany({ select: { id: true, name: true, source: { select: { adapterId: true } } }, orderBy: { name: "asc" } }),
        prisma.execution.groupBy({ by: ["triggerType", "triggerLabel"], _count: { _all: true } }),
    ]);
    const options = new Map<string, RunStarterOption>();
    for (const group of starters) {
        const starter = starterOf(group.triggerType, group.triggerLabel);
        const optionGroup = { schedule: "System", manual: "By hand", api: "API keys", none: "Other" }[starter.kind] as RunStarterOption["group"];
        options.set(starter.key, { value: starter.key, label: starter.label, group: optionGroup });
    }
    return {
        jobs: jobs.map((job) => ({ id: job.id, name: job.name, adapterId: job.source?.adapterId ?? null })),
        starters: [...options.values()].sort((a, b) => STARTER_ORDER[a.group] - STARTER_ORDER[b.group] || a.label.localeCompare(b.label)),
    };
}

/** The numbers above the list: the last 30 days, and what runs and waits right now. */
export function getRunStats(now = new Date()): Promise<RunStats> {
    return cached("history-stats", STATS_TTL_MS, async () => {
        const since = new Date(now.getTime() - 30 * DAY_MS);
        const [byStatus, lastFailed, lastPartial, live] = await Promise.all([
            prisma.execution.groupBy({ by: ["status"], where: { startedAt: { gte: since } }, _count: { _all: true } }),
            prisma.execution.findFirst({ where: { status: "Failed", startedAt: { gte: since } }, orderBy: { startedAt: "desc" }, select: RUN_SELECT }),
            prisma.execution.findFirst({ where: { status: "Partial", startedAt: { gte: since } }, orderBy: { startedAt: "desc" }, select: RUN_SELECT }),
            prisma.execution.findMany({ where: { status: { in: ["Running", "Pending"] } }, orderBy: { startedAt: "asc" }, select: RUN_SELECT }),
        ]);
        const counts = tally(byStatus, (group) => group.status, (group) => group._count._all);
        const named = (record: RunRecord | null) => (record ? { name: runRow(record, null, null).name, at: record.startedAt.toISOString() } : null);
        return {
            total: Object.values(counts).reduce((sum, value) => sum + value, 0),
            succeeded: counts.Success ?? 0,
            failed: counts.Failed ?? 0,
            lastFailed: named(lastFailed),
            partial: counts.Partial ?? 0,
            lastPartial: named(lastPartial),
            running: live.filter((record) => record.status === "Running").map((record) => runRow(record, null, null).name),
            queued: live.filter((record) => record.status === "Pending").map((record) => runRow(record, null, null).name),
        };
    });
}
