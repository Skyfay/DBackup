"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ColumnFiltersState, OnChangeFn, PaginationState } from "@tanstack/react-table";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ component: "usePagedList" });

export interface PagedResult<T> {
    rows: T[];
    total: number;
}

export interface PagedQuery {
    pagination: PaginationState;
    columnFilters: ColumnFiltersState;
}

interface UsePagedListOptions<T> {
    /** Loads one page. Called on mount, on every state change, and on each poll tick. */
    load: (query: PagedQuery) => Promise<PagedResult<T>>;
    /** Only the visible tab fetches and polls. */
    enabled: boolean;
    /** Poll interval in ms. Zero disables polling. */
    pollMs: number;
    initialPageSize?: number;
    /** Runs whenever a page arrives, for state the caller keeps outside the rows. */
    onLoaded?: (result: PagedResult<T>) => void;
}

/**
 * Server-side pagination and filtering for a DataTable that polls.
 *
 * The table controls `pagination` and `columnFilters`, this hook turns every change into a
 * fetch of exactly one page. Filter changes reset to the first page. Polling only runs while
 * `enabled` and the tab is visible, and a tick never stacks on a request still in flight.
 */
export function usePagedList<T>({
    load,
    enabled,
    pollMs,
    initialPageSize = 10,
    onLoaded,
}: UsePagedListOptions<T>) {
    const [rows, setRows] = useState<T[]>([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: initialPageSize });
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

    const inFlight = useRef(false);
    // Each request takes a ticket. A response only lands when it is still the newest one, so
    // a slow poll cannot overwrite the page the user just navigated to.
    const ticket = useRef(0);
    const onLoadedRef = useRef(onLoaded);
    onLoadedRef.current = onLoaded;

    /**
     * Poll ticks (`force` false) skip while a request is in flight so they never stack. User
     * driven loads (`force` true) always go out and show the loading state.
     */
    const refresh = useCallback(async (force = false) => {
        if (!force && inFlight.current) return;
        const mine = ++ticket.current;
        inFlight.current = true;
        if (force) setIsLoading(true);
        try {
            const result = await load({ pagination, columnFilters });
            if (mine !== ticket.current) return;
            setRows(result.rows);
            setTotal(result.total);
            onLoadedRef.current?.(result);
        } catch (e) {
            log.error("Failed to load page", {}, wrapError(e));
        } finally {
            if (mine === ticket.current) {
                inFlight.current = false;
                setIsLoading(false);
            }
        }
    }, [load, pagination, columnFilters]);

    // Filters narrow the result set, so page N of the old set is meaningless.
    const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = useCallback((updater) => {
        setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
        setColumnFilters(updater);
    }, []);

    // Typing in the search box changes filters on every keystroke, so the first fetch after a
    // change waits briefly. Polling and page changes go through the same path, which keeps the
    // in-flight guard the single place that serialises requests.
    useEffect(() => {
        if (!enabled) return;
        const timer = setTimeout(() => refresh(true), 250);
        return () => clearTimeout(timer);
    }, [enabled, refresh]);

    useEffect(() => {
        if (!enabled || pollMs <= 0) return;
        const tick = () => {
            // A hidden tab is polling for nobody, and browsers throttle its timers anyway.
            if (typeof document !== "undefined" && document.hidden) return;
            refresh(false);
        };
        const interval = setInterval(tick, pollMs);
        const onVisible = () => { if (!document.hidden) refresh(false); };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [enabled, pollMs, refresh]);

    /** Manual refresh, for the toolbar button and after a mutation. */
    const manualRefresh = useCallback(() => { refresh(true); }, [refresh]);

    return {
        rows,
        total,
        isLoading,
        pagination,
        setPagination,
        columnFilters,
        onColumnFiltersChange,
        refresh: manualRefresh,
        pageCount: Math.max(1, Math.ceil(total / pagination.pageSize)),
    };
}

/** Read a faceted (multi-select) filter's values off the table state. */
export function filterValues(filters: ColumnFiltersState, id: string): string[] {
    const value = filters.find((f) => f.id === id)?.value;
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "string" && value) return [value];
    return [];
}

/** Read the free-text filter off the table state. */
export function filterText(filters: ColumnFiltersState, id: string): string {
    const value = filters.find((f) => f.id === id)?.value;
    return typeof value === "string" ? value.trim() : "";
}
