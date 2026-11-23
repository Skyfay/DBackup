"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { TENANT_COLUMN_ID } from "@/components/tenant/tenant-rows";
import { filterText, filterValues, usePagedList, type PagedQuery } from "@/hooks/use-paged-list";
import type { JobListItem } from "@/services/jobs/job-list-service";
import type { JobFilter, JobPage } from "@/services/jobs/job-page-types";

/** How often the list asks again: every few seconds while a job runs, every half minute otherwise. */
const LIVE_INTERVAL_MS = 3000;
const IDLE_INTERVAL_MS = 30000;

/**
 * The jobs the Timeline and Upcoming views draw at once, which have no pages of their own. Every
 * job of any usual instance, the first ones of a bigger one, which the search and filters narrow.
 */
export const TIMELINE_JOBS = 500;

/** Reads jobs from the server: a page, or the jobs of `ids` whatever the filters. */
export async function fetchJobPage(params: URLSearchParams): Promise<JobPage> {
    const response = await fetch(`/api/jobs/list?${params.toString()}`);
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) throw new Error(body?.error ?? "The jobs could not be loaded.");
    return body.data as JobPage;
}

/** The jobs of these ids as the list shows them, whatever page they are on. */
export async function fetchJobs(ids: string[]): Promise<JobListItem[]> {
    if (ids.length === 0) return [];
    const params = new URLSearchParams();
    for (const id of ids) params.append("id", id);
    return (await fetchJobPage(params)).rows;
}

function pageParams(query: PagedQuery, filter: JobFilter, timeline: boolean): URLSearchParams {
    const params = new URLSearchParams();
    // The Timeline and Upcoming draw the jobs of their window at once, from the first.
    params.set("page", String(timeline ? 1 : query.pagination.pageIndex + 1));
    params.set("pageSize", String(timeline ? TIMELINE_JOBS : query.pagination.pageSize));
    if (filter !== "all") params.set("filter", filter);
    const search = filterText(query.columnFilters, "name");
    if (search) params.set("search", search);
    // The Tenant filter only exists in All tenants, where the server narrows by it.
    for (const tenantId of filterValues(query.columnFilters, TENANT_COLUMN_ID)) params.append("tenant", tenantId);
    return params;
}

interface UseJobListOptions {
    filter: JobFilter;
    /** The Timeline or Upcoming view is shown, which draws up to `TIMELINE_JOBS` at once. */
    timeline: boolean;
    /** The rows per page the table layout keeps. */
    pageSize?: number;
    /** False until the screen is measured, which decides between the table and the timelines. */
    enabled?: boolean;
}

/**
 * The jobs with how they are doing, a page at a time from the server and kept fresh. Only the first
 * load shows a skeleton, a refresh keeps the rows and spins the button, a hidden tab does not ask at
 * all, and a poll that fails stays quiet.
 */
export function useJobList({ filter, timeline, pageSize, enabled = true }: UseJobListOptions) {
    const [page, setPage] = useState<JobPage | null>(null);
    const [pollMs, setPollMs] = useState(IDLE_INTERVAL_MS);

    const load = useCallback(async (query: PagedQuery) => {
        const data = await fetchJobPage(pageParams(query, filter, timeline));
        setPage(data);
        // A live run anywhere is followed closely, the list at an easy pace otherwise.
        setPollMs(data.live ? LIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
        return { rows: data.rows, total: data.total };
    }, [filter, timeline]);
    const onError = useCallback((error: unknown, quiet: boolean) => {
        if (!quiet) toast.error(error instanceof Error ? error.message : "The jobs could not be loaded.");
    }, []);
    const list = usePagedList<JobListItem>({ load, enabled, pollMs, onError, initialPageSize: pageSize });
    const { setPagination } = list;

    // Another quick filter narrows the list, so the page it was on means nothing anymore.
    useEffect(() => {
        setPagination((previous) => (previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 }));
    }, [filter, setPagination]);

    return { ...list, page };
}

/**
 * The jobs of these ids that the page does not hold, read on their own, like the one a link names
 * or the one whose panel stays open while the list moves to another page. They are read again with
 * every page that arrives, so they stay as fresh as the list. `ready` once the ones asked for came.
 */
export function useJobsBeside(rows: JobListItem[], ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0 && !rows.some((row) => row.id === id)))];
    const key = wanted.join(",");
    const [state, setState] = useState<{ key: string; jobs: JobListItem[] } | null>(null);

    useEffect(() => {
        if (!key) return;
        let ignore = false;
        fetchJobs(key.split(","))
            .then((jobs) => {
                if (!ignore) setState({ key, jobs });
            })
            .catch(() => {
                // A job that cannot be read is left out, like one deleted since.
                if (!ignore) setState({ key, jobs: [] });
            });
        return () => {
            ignore = true;
        };
    }, [key, rows]);

    const current = state?.key === key ? state.jobs : [];
    return { jobs: key ? current : [], ready: !key || state?.key === key };
}

/** The names of the jobs whose name holds this one, like the copies of a job, for a clone to pick a free name. */
export async function namesLike(name: string): Promise<string[]> {
    const params = new URLSearchParams({ search: name, pageSize: String(TIMELINE_JOBS) });
    return (await fetchJobPage(params)).rows.map((job) => job.name);
}
