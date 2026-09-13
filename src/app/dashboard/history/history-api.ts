"use client";

import type { Execution } from "./columns";
import type { ExecutionHistoryFacets } from "@/services/system/execution-history-service";
import type { NotificationLogFacets } from "@/services/notifications/notification-log-service";
import type { NotificationLogRow } from "./notification-log-columns";
import { filterText, filterValues, type PagedQuery, type PagedResult } from "./use-paged-list";

/** Which of the two execution tabs a query is for. Mirrors the `scope` parameter of /api/history. */
export type ExecutionScope = "activity" | "system";

function pageParams(query: PagedQuery): URLSearchParams {
    const params = new URLSearchParams();
    params.set("page", String(query.pagination.pageIndex + 1));
    params.set("pageSize", String(query.pagination.pageSize));
    // The counts next to the filter options. They used to be derived from the rows in the
    // browser, which only works when the browser holds every row.
    params.set("facets", "true");
    return params;
}

function appendAll(params: URLSearchParams, key: string, values: string[]) {
    for (const value of values) params.append(key, value);
}

/** One page of the Activity Logs or System Tasks tab, plus the system timezone the page shows dates in. */
export async function loadExecutions(
    scope: ExecutionScope,
    query: PagedQuery,
): Promise<PagedResult<Execution> & { systemTimezone: string; facets?: ExecutionHistoryFacets }> {
    const params = pageParams(query);
    params.set("scope", scope);
    appendAll(params, "type", filterValues(query.columnFilters, "type"));
    appendAll(params, "status", filterValues(query.columnFilters, "status"));
    appendAll(params, "trigger", filterValues(query.columnFilters, "trigger"));
    const search = filterText(query.columnFilters, scope === "activity" ? "jobName" : "taskName");
    if (search) params.set("search", search);

    const res = await fetch(`/api/history?${params.toString()}`);
    if (!res.ok) throw new Error(`History request failed with ${res.status}`);
    const data = await res.json();
    return { rows: data.executions, total: data.total, systemTimezone: data.systemTimezone ?? "UTC", facets: data.facets };
}

/** One page of the Notification Logs tab. */
export async function loadNotificationLogs(
    query: PagedQuery,
): Promise<PagedResult<NotificationLogRow> & { facets?: NotificationLogFacets }> {
    const params = pageParams(query);
    appendAll(params, "adapterId", filterValues(query.columnFilters, "adapterId"));
    appendAll(params, "status", filterValues(query.columnFilters, "status"));
    const search = filterText(query.columnFilters, "title");
    if (search) params.set("search", search);

    const res = await fetch(`/api/notification-logs?${params.toString()}`);
    if (!res.ok) throw new Error(`Notification log request failed with ${res.status}`);
    const data = await res.json();
    return { rows: data.data, total: data.total, facets: data.facets };
}

/** A single execution row by id, for opening a run that is not on the loaded page. */
export async function loadExecution(id: string): Promise<Execution | null> {
    const res = await fetch(`/api/history/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.execution ?? null;
}
