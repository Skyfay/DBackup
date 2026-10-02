"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Database, Table2 } from "lucide-react";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ColumnInfo } from "@/lib/core/interfaces";
import { cn } from "@/lib/utils";
import { RedisKeys, RowsGrid, SchemaTable } from "./database-grids";
import { ClosedNote, PANE } from "./database-pane";
import { ColumnsMenu, RowsFilter, SortChip, type RowFilter, type RowSort } from "./database-rows-parts";

const KEY_STORES = ["redis", "valkey"];
/** How many keys the Redis browser reads at once, `SCAN_LIMIT` in `redis/browser.ts`. */
const KEY_PAGE = 200;
const PAGE_SIZES = [25, 50, 100];

interface RowsState {
    query: string;
    rows: Record<string, unknown>[];
    columns: ColumnInfo[];
    total: number;
    error: string | null;
}

interface DatabaseRowsProps {
    sourceId: string;
    adapterId: string;
    database: string;
    table: string;
    /** The name on top when it is not the table, like db0 for the keys of a Redis database. */
    title?: string;
    serverName: string;
}

/**
 * The rows of a table, read live from the server a page at a time: a filter on one column, the
 * sort of a column, the columns to show and the pages. The Columns tab lists how the table is
 * built. The keys of Redis and Valkey come without pages, the first ones SCAN finds, and the
 * filter matches the key on the server.
 */
export function DatabaseRows({ sourceId, adapterId, database, table, title, serverName }: DatabaseRowsProps) {
    const [tab, setTab] = useState<"data" | "columns">("data");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [filter, setFilter] = useState<RowFilter | null>(null);
    const [sort, setSort] = useState<RowSort | null>(null);
    const [hidden, setHidden] = useState<Set<string>>(new Set());
    const [version, setVersion] = useState(0);
    const [state, setState] = useState<RowsState | null>(null);
    const keyStore = KEY_STORES.includes(adapterId);
    const documents = adapterId === "mongodb";

    const body = {
        sourceId, database, table, page, pageSize,
        ...(filter ? { search: filter.value, searchColumn: filter.column, matchMode: filter.mode } : {}),
        ...(sort ? { sortBy: sort.column, sortDir: sort.dir } : {}),
    };
    const query = JSON.stringify(body);

    useEffect(() => {
        let ignore = false;
        fetch("/api/adapters/database-table-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: query })
            .then((res) => res.json().catch(() => null))
            .then((payload) => {
                if (ignore) return;
                if (payload?.success) {
                    setState({ query, rows: payload.rows ?? [], columns: payload.columns ?? [], total: payload.totalCount ?? 0, error: null });
                } else {
                    setState((previous) => ({ query, rows: [], columns: previous?.columns ?? [], total: 0, error: payload?.message ?? payload?.error ?? "The server did not hand out the rows." }));
                }
            })
            .catch(() => {
                if (!ignore) setState((previous) => ({ query, rows: [], columns: previous?.columns ?? [], total: 0, error: "The server could not be reached." }));
            });
        return () => {
            ignore = true;
        };
    }, [query, version]);

    const loading = state?.query !== query;
    const columns = state?.columns ?? [];
    const shownColumns = columns.filter((column) => !hidden.has(column.name));
    // SCAN matches nothing but the key.
    const filterColumns = keyStore ? columns.filter((column) => column.name === "key") : columns;
    const pages = Math.max(1, Math.ceil((state?.total ?? 0) / pageSize));
    const first = (page - 1) * pageSize + 1;
    const noun = keyStore ? "keys" : documents ? "documents" : "rows";
    const Icon = keyStore ? Database : Table2;

    const toggleSort = (column: string) => {
        setSort((current) => (current?.column === column ? (current.dir === "asc" ? { column, dir: "desc" } : null) : { column, dir: "asc" }));
        setPage(1);
    };

    return (
        <div className={cn(PANE, "gap-3 p-4")}>
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <p className="truncate font-semibold">{title ?? table}</p>
                    {state && !state.error && (
                        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{state.total.toLocaleString()} {filter ? "match" : noun}</span>
                    )}
                </div>
                {!keyStore && (
                    <Tabs value={tab} onValueChange={(next) => setTab(next as "data" | "columns")}>
                        <TabsList className="h-8">
                            <TabsTrigger value="data" className="px-2.5 text-xs">Data</TabsTrigger>
                            <TabsTrigger value="columns" className="px-2.5 text-xs">
                                Columns
                                {columns.length > 0 && <span className="text-muted-foreground tabular-nums">{columns.length}</span>}
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}
            </div>

            {tab === "columns" && !keyStore ? (
                loading && columns.length === 0 ? <Skeleton className="h-40 w-full" /> : <SchemaTable columns={columns} />
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-2">
                        {filterColumns.length > 0 && (
                            <RowsFilter
                                columns={filterColumns}
                                filter={filter}
                                note={keyStore ? `The server looks through the keys for the first ${KEY_PAGE} that match` : undefined}
                                onChange={(next) => {
                                    setFilter(next);
                                    setPage(1);
                                }}
                            />
                        )}
                        {sort && <SortChip sort={sort} onClear={() => setSort(null)} />}
                        <div className="ml-auto flex items-center gap-2">
                            {!keyStore && columns.length > 0 && (
                                <ColumnsMenu
                                    columns={columns}
                                    hidden={hidden}
                                    onToggle={(column, shown) => setHidden((current) => {
                                        const next = new Set(current);
                                        if (shown) next.delete(column);
                                        else next.add(column);
                                        return next;
                                    })}
                                />
                            )}
                            <RefreshButton variant="outline" onRefresh={() => setVersion((value) => value + 1)} busy={loading} label={`Read the ${noun} again`} className="size-8" />
                        </div>
                    </div>

                    {loading && !state ? (
                        <div className="space-y-2" aria-busy="true">
                            {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-7 w-full" />)}
                        </div>
                    ) : state?.error ? (
                        <ClosedNote title={`The ${noun} could not be read`} message={state.error}>
                            The login of {serverName} may not read {title ?? table}. Its backups do not depend on it.
                        </ClosedNote>
                    ) : state && state.rows.length === 0 ? (
                        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                            {filter ? `No ${noun} match the filter.` : `${title ?? table} holds no ${noun}.`}
                        </p>
                    ) : state ? (
                        // A column that fills the pane, so the grid in it scrolls.
                        <div className={cn("flex min-w-0 flex-col transition-opacity lg:min-h-0 lg:flex-1", loading && "opacity-60")}>
                            {keyStore ? <RedisKeys rows={state.rows} /> : <RowsGrid columns={shownColumns} rows={state.rows} sort={sort} onSort={toggleSort} />}
                        </div>
                    ) : null}

                    {state && !state.error && state.rows.length > 0 && keyStore && (
                        <p className="text-sm text-muted-foreground tabular-nums">
                            {filter
                                ? state.rows.length >= KEY_PAGE ? `The first ${KEY_PAGE} keys that match` : `${count(state.rows.length, "key")} match`
                                : state.total > state.rows.length ? `The first ${state.rows.length.toLocaleString()} of ${state.total.toLocaleString()} keys, a filter finds the others` : count(state.total, "key")}
                        </p>
                    )}

                    {state && !state.error && state.total > 0 && !keyStore && (
                        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                            <span className="tabular-nums">
                                {first.toLocaleString()} to {Math.min(page * pageSize, state.total).toLocaleString()} of {state.total.toLocaleString()} {noun}
                            </span>
                            <div className="flex items-center gap-2">
                                <Select
                                    value={String(pageSize)}
                                    onValueChange={(value) => {
                                        setPageSize(Number(value));
                                        setPage(1);
                                    }}
                                >
                                    <SelectTrigger size="sm" className="h-8 w-24" aria-label={`${noun} per page`}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size} a page</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <Button variant="outline" size="icon" className="size-8" aria-label="Previous page" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>
                                    <ChevronLeft />
                                </Button>
                                <span className="tabular-nums">{page} of {pages.toLocaleString()}</span>
                                <Button variant="outline" size="icon" className="size-8" aria-label="Next page" onClick={() => setPage((value) => Math.min(pages, value + 1))} disabled={page >= pages || loading}>
                                    <ChevronRight />
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
