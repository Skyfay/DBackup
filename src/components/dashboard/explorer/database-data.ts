"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";
import { TENANT_COLUMN_ID } from "@/components/tenant/tenant-rows";
import { filterText, filterValues, usePagedList, type PagedQuery } from "@/hooks/use-paged-list";
import { logger } from "@/lib/logging/logger";
import type { DatabaseOverview, DatabasePage, DatabaseRunsData, DatabaseSort, ExplorerDatabase } from "@/services/databases/database-explorer-types";
import { expandRuns } from "./database-model";

const log = logger.child({ component: "database-explorer" });

async function fetchData<T>(url: string, fallback: string): Promise<T> {
    const res = await fetch(url);
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.success) throw new Error(payload?.error ?? fallback);
    return payload.data as T;
}

interface Loaded<T> {
    url: string;
    data: T | null;
    error: string | null;
}

/**
 * Loads a view of the Database Explorer. A new address starts empty, so the page shows its
 * skeleton, while `reload` keeps what is shown until the fresh answer is in.
 */
export function useDatabaseData<T>(url: string | null, fallback = "The databases could not be loaded.") {
    const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
    const [version, setVersion] = useState(0);
    const [reloading, setReloading] = useState(false);

    useEffect(() => {
        if (!url) return;
        let ignore = false;
        fetchData<T>(url, fallback)
            .then((data) => {
                if (!ignore) setLoaded({ url, data, error: null });
            })
            .catch((error: unknown) => {
                if (ignore) return;
                log.error("Loading the databases failed", { url }, error instanceof Error ? error : undefined);
                setLoaded((previous) => ({ url, data: previous?.url === url ? previous.data : null, error: error instanceof Error ? error.message : fallback }));
            })
            .finally(() => {
                if (!ignore) setReloading(false);
            });
        return () => {
            ignore = true;
        };
    }, [url, version, fallback]);

    const reload = useCallback(() => {
        setReloading(true);
        setVersion((value) => value + 1);
    }, []);

    const current = loaded?.url === url ? loaded : null;
    return { data: current?.data ?? null, error: current?.error ?? null, loading: url !== null && current === null, reloading, reload };
}

/**
 * The databases the timeline draws at once, which pages its rows itself. Every database of any
 * usual instance, the biggest ones of a bigger one, which the search and the filters narrow.
 */
export const TIMELINE_DATABASES = 1000;

/** The sort of the API by the column the table sorts by. */
const SORTS: Record<string, DatabaseSort> = { size: "size", database: "database", serverName: "server", tables: "tables", last: "last" };

function pageParams(query: PagedQuery, sorting: SortingState, timeline: boolean): URLSearchParams {
    const params = new URLSearchParams();
    params.set("page", String(timeline ? 1 : query.pagination.pageIndex + 1));
    params.set("pageSize", String(timeline ? TIMELINE_DATABASES : query.pagination.pageSize));
    const sort = sorting[0];
    if (sort && SORTS[sort.id]) {
        params.set("sort", SORTS[sort.id]);
        params.set("order", sort.desc ? "desc" : "asc");
    }
    const search = filterText(query.columnFilters, "database");
    if (search) params.set("search", search);
    // The Tenant filter only exists in All tenants, where the server narrows by it.
    for (const [id, name] of [["server", "server"], ["engine", "engine"], ["job", "job"], ["state", "state"], [TENANT_COLUMN_ID, "tenant"]] as const) {
        for (const value of filterValues(query.columnFilters, id)) params.append(name, value);
    }
    return params;
}

/**
 * The databases of the Databases tab a page at a time from the server, which searches, filters,
 * sorts and counts them. `timeline` reads up to `TIMELINE_DATABASES` at once for the timeline,
 * which a viewer who may not see jobs never gets.
 */
export function useDatabasePage({ sorting, timeline: wantsTimeline, initialFilters, enabled = true }: { sorting: SortingState; timeline: boolean; initialFilters?: ColumnFiltersState; enabled?: boolean }) {
    const [page, setPage] = useState<DatabasePage | null>(null);
    const [error, setError] = useState<string | null>(null);
    const timeline = wantsTimeline && page?.coverage !== false;
    const load = useCallback(async (query: PagedQuery) => {
        const data = await fetchData<DatabasePage>(`/api/databases/list?${pageParams(query, sorting, timeline).toString()}`, "The databases could not be loaded.");
        setPage(data);
        setError(null);
        return { rows: data.rows, total: data.total };
    }, [sorting, timeline]);
    const onError = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : "The databases could not be loaded."), []);
    const list = usePagedList<ExplorerDatabase>({ load, enabled, pollMs: 0, onError, initialFilters });
    const { setPagination } = list;

    // Another order starts at its first page.
    useEffect(() => {
        setPagination((previous) => (previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 }));
    }, [sorting, setPagination]);

    return { ...list, page, error };
}

/** The runs of a span as the timeline and the panel of a day need them, with the databases of each run looked up. */
export function useDatabaseRuns(url: string | null) {
    const loaded = useDatabaseData<DatabaseRunsData>(url, "The runs could not be loaded.");
    const data = useMemo(() => (loaded.data ? expandRuns(loaded.data) : null), [loaded.data]);
    return { ...loaded, data };
}

/** Reads the databases of these servers, or of all of them, from the servers now, and answers with the fresh overview. */
export async function readNow(serverIds?: string[]): Promise<DatabaseOverview> {
    const res = await fetch("/api/databases/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverIds ? { serverIds } : {}),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.success) throw new Error(payload?.error ?? "The servers could not be read.");
    return payload.data as DatabaseOverview;
}

/** The address of the backups of these jobs on the Backups page. */
export function backupsHref(jobIds: string[]): string {
    const params = new URLSearchParams();
    for (const id of jobIds) params.append("job", id);
    return `/dashboard/backups?${params.toString()}`;
}
