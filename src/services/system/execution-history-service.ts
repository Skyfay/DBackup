/**
 * Execution History Service
 *
 * Paged, filtered listing of executions for the History page and the
 * `GET /api/history` endpoint. The list never carries the `logs` column, which
 * holds the entire log of a run as JSON. The open dialog fetches the one log it
 * needs from `/api/executions/[id]`.
 */

import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Execution types that show up under System Tasks rather than Activity Logs. */
export const SYSTEM_TASK_TYPES = ["IntegrityCheck", "Verification"] as const;

export const HISTORY_MAX_PAGE_SIZE = 100;
export const HISTORY_DEFAULT_PAGE_SIZE = 100;

export type ExecutionHistoryScope = "activity" | "system" | "all";

export interface ExecutionHistoryQuery {
  /** 1-based page number. */
  page?: number;
  pageSize?: number;
  /** Which tab the rows are for. Defaults to every execution. */
  scope?: ExecutionHistoryScope;
  /** Execution types to include, for example `Backup` or `Restore`. */
  types?: string[];
  statuses?: string[];
  /** Trigger types, for example `Manual`, `Scheduler` or `Api`. */
  triggers?: string[];
  /**
   * Free text. Matches the job name for the activity scope and the execution
   * type for the system scope. Matches either when no scope is given.
   */
  search?: string;
}

/** Row shape returned by the list. Deliberately without `logs`. */
export const executionHistorySelect = {
  id: true,
  jobId: true,
  type: true,
  status: true,
  startedAt: true,
  endedAt: true,
  path: true,
  metadata: true,
  triggerType: true,
  triggerLabel: true,
  job: { select: { name: true } },
} satisfies Prisma.ExecutionSelect;

export type ExecutionHistoryRow = Prisma.ExecutionGetPayload<{ select: typeof executionHistorySelect }>;

/** Clamp a page size coming from a query string into the allowed range. */
export function normalizeHistoryPageSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 1) return HISTORY_DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(value), HISTORY_MAX_PAGE_SIZE);
}

function cleanList(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter((v) => v.length > 0);
}

/** Build the Prisma `where` clause for a history query. Exported for tests. */
export function buildExecutionHistoryWhere(query: ExecutionHistoryQuery): Prisma.ExecutionWhereInput {
  const scope = query.scope ?? "all";
  const and: Prisma.ExecutionWhereInput[] = [];

  if (scope === "system") {
    and.push({ type: { in: [...SYSTEM_TASK_TYPES] } });
  } else if (scope === "activity") {
    and.push({ type: { notIn: [...SYSTEM_TASK_TYPES] } });
  }

  const types = cleanList(query.types);
  if (types.length > 0) and.push({ type: { in: types } });

  const statuses = cleanList(query.statuses);
  if (statuses.length > 0) and.push({ status: { in: statuses } });

  const triggers = cleanList(query.triggers);
  if (triggers.length > 0) and.push({ triggerType: { in: triggers } });

  const search = query.search?.trim();
  if (search) {
    const byJob: Prisma.ExecutionWhereInput = { job: { is: { name: { contains: search } } } };
    const byType: Prisma.ExecutionWhereInput = { type: { contains: search } };
    if (scope === "activity") and.push(byJob);
    else if (scope === "system") and.push(byType);
    else and.push({ OR: [byJob, byType] });
  }

  return and.length > 0 ? { AND: and } : {};
}

/** Counts per value for the three faceted filters on the History page. */
export interface ExecutionHistoryFacets {
  type: Record<string, number>;
  status: Record<string, number>;
  trigger: Record<string, number>;
}

/**
 * How many rows each filter option would match. Like a client-side faceted table, a
 * column's counts honour every other active filter but not its own, so the numbers next to
 * the options stay meaningful while one of them is selected.
 */
export async function getExecutionHistoryFacets(query: ExecutionHistoryQuery): Promise<ExecutionHistoryFacets> {
  const count = async (column: "type" | "status" | "triggerType", omit: keyof ExecutionHistoryQuery) => {
    const where = buildExecutionHistoryWhere({ ...query, [omit]: undefined });
    const groups = await prisma.execution.groupBy({ by: [column], where, _count: { _all: true } });
    const result: Record<string, number> = {};
    for (const g of groups) {
      const key = g[column];
      if (key) result[key] = g._count._all;
    }
    return result;
  };

  const [type, status, trigger] = await Promise.all([
    count("type", "types"),
    count("status", "statuses"),
    count("triggerType", "triggers"),
  ]);
  return { type, status, trigger };
}

/** Newest first, one page at a time, with the total behind the filters. */
export async function listExecutionHistory(query: ExecutionHistoryQuery = {}) {
  const page = query.page && query.page > 0 ? Math.floor(query.page) : 1;
  const pageSize = normalizeHistoryPageSize(query.pageSize);
  const where = buildExecutionHistoryWhere(query);

  const [data, total] = await Promise.all([
    prisma.execution.findMany({
      where,
      select: executionHistorySelect,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.execution.count({ where }),
  ]);

  return { data, total, page, pageSize };
}

/** One execution in the same shape as the list, or null when it does not exist. */
export async function getExecutionHistoryRow(id: string): Promise<ExecutionHistoryRow | null> {
  return prisma.execution.findUnique({ where: { id }, select: executionHistorySelect });
}
