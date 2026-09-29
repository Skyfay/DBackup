"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { CalendarRange, ListFilter } from "lucide-react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { PickChip } from "@/components/dashboard/storage/explorer/explorer-controls";
import { useTimelineFormat } from "@/components/dashboard/storage/explorer/timeline-cells";
import { DataTable } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { filterText, filterValues, usePagedList, type PagedQuery } from "@/hooks/use-paged-list";
import type { AuditQuick } from "@/lib/core/audit-areas";
import type { AuditPage, AuditRow } from "@/services/audit/audit-types";
import { AuditCard } from "./audit-card";
import { auditColumns } from "./audit-columns";
import { AuditDetails } from "./audit-details";
import { auditFilters } from "./audit-filters";
import { AuditStrip } from "./audit-strip";
import { AuditTimeline, type AuditPick } from "./audit-timeline";

/** What the page around the list can start, like Export CSV beside the tabs. */
export interface AuditTabHandle {
    exportCsv: () => void;
}

type Period = "24h" | "7d" | "30d" | "90d" | "all";

const PERIODS: { value: Period; label: string }[] = [
    { value: "24h", label: "Last 24 hours" },
    { value: "7d", label: "Last 7 days" },
    { value: "30d", label: "Last 30 days" },
    { value: "90d", label: "Last 90 days" },
    { value: "all", label: "Everything kept" },
];

interface RecordFilter {
    resource: string;
    resourceId: string;
    label: string;
}

/** The filters of the table, the quick filter and a record as the query of a request, without the period. */
function filterParams(columnFilters: ColumnFiltersState, quick: AuditQuick, record: RecordFilter | null): URLSearchParams {
    const params = new URLSearchParams();
    for (const id of ["who", "area", "action"] as const) {
        for (const value of filterValues(columnFilters, id)) params.append(id, value);
    }
    const search = filterText(columnFilters, "what");
    if (search) params.set("search", search);
    if (quick !== "all") params.set("quick", quick);
    if (record) params.set("record", `${record.resource}:${record.resourceId}`);
    return params;
}

interface AuditTabProps {
    ref?: Ref<AuditTabHandle>;
    view: "table" | "timeline";
    /** A phone gets cards. */
    cards: boolean;
    /** May sign people out from the panel of a sign-in. */
    canSignOut: boolean;
}

/**
 * The audit log: the numbers of the last 30 days, then every entry as a sentence with who did it,
 * the area and where from, a page at a time from the server. A click opens what changed and the
 * entries around it, the timeline above the list shows who did what by day and picks the entries.
 */
export function AuditTab({ ref, view, cards, canSignOut }: AuditTabProps) {
    const format = useTimelineFormat();
    const { timezone } = useDateFormatter();
    const [quick, setQuick] = useState<AuditQuick>("all");
    const [period, setPeriod] = useState<Period>("30d");
    const [pick, setPick] = useState<AuditPick | null>(null);
    const [record, setRecord] = useState<RecordFilter | null>(null);
    const [page, setPage] = useState<AuditPage | null>(null);
    const [details, setDetails] = useState<{ row: AuditRow; open: boolean } | null>(null);
    const [now] = useState(() => Date.now());
    const timeline = view === "timeline" && !cards;

    /** The whole query of the list: the filters, and the period or what the timeline picked. */
    const queryOf = useCallback((columnFilters: ColumnFiltersState) => {
        const params = filterParams(columnFilters, quick, record);
        if (timeline && pick) {
            if (pick.who) {
                params.delete("who");
                params.append("who", pick.who);
            }
            const from = pick.day ?? pick.from;
            const to = pick.day ?? pick.to;
            if (from && to) {
                params.set("fromDay", from);
                params.set("toDay", to);
                params.set("tz", timezone);
            }
            params.set("period", "all");
        } else {
            params.set("period", period);
        }
        return params;
    }, [quick, record, timeline, pick, period, timezone]);

    const load = useCallback(async (query: PagedQuery) => {
        const params = queryOf(query.columnFilters);
        params.set("page", String(query.pagination.pageIndex + 1));
        params.set("pageSize", String(query.pagination.pageSize));
        const response = await fetch(`/api/audit?${params.toString()}`);
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error ?? `The audit log request failed with ${response.status}`);
        const data = body.data as AuditPage;
        setPage(data);
        return { rows: data.rows, total: data.total };
    }, [queryOf]);
    // The list loads while the timeline hides it too, since the numbers and the filters come with it.
    const list = usePagedList<AuditRow>({ load, enabled: true, pollMs: 0 });
    const { setPagination, columnFilters } = list;

    // A new quick filter, period, record or pick narrows the list, so the page it was on means nothing anymore.
    useEffect(() => {
        setPagination((previous) => (previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 }));
    }, [quick, period, record, pick, view, setPagination]);

    useImperativeHandle(ref, () => ({
        exportCsv: () => {
            // The browser fetches the file itself, so it goes straight to disk instead of into the tab.
            const anchor = document.createElement("a");
            anchor.href = `/api/audit/export?${queryOf(columnFilters).toString()}`;
            anchor.download = "";
            anchor.click();
        },
    }), [queryOf, columnFilters]);

    const open = useCallback((row: AuditRow) => setDetails({ row, open: true }), []);
    const columns = useMemo(() => auditColumns({ now }), [now]);
    const filters = useMemo(() => auditFilters(page), [page]);
    const counts = page?.facets.quick;
    const timelineQuery = useMemo(() => filterParams(columnFilters, quick, record).toString(), [columnFilters, quick, record]);

    const pickLabel = pick
        ? [pick.whoName ?? null, pick.day ? format.short(pick.day) : pick.from && pick.to ? `${format.short(pick.from)} to ${format.short(pick.to)}` : null].filter(Boolean).join(", ")
        : "";

    return (
        <div className="space-y-4 md:space-y-0">
            <AuditStrip stats={page?.stats ?? null} />
            <DataTable
                variant="card"
                joined
                columns={columns}
                data={list.rows}
                searchKey="what"
                searchPlaceholder="Search names, people or addresses"
                filterableColumns={filters}
                manualPagination
                manualFiltering
                pagination={list.pagination}
                onPaginationChange={list.setPagination}
                columnFilters={list.columnFilters}
                onColumnFiltersChange={list.onColumnFiltersChange}
                pageCount={list.pageCount}
                rowCount={list.total}
                onRefresh={list.refresh}
                isLoading={list.isLoading}
                getRowId={(row) => row.id}
                onRowClick={open}
                activeRowId={details?.open ? details.row.id : null}
                view={cards ? "cards" : "table"}
                renderCard={(row) => <AuditCard row={row.original} onOpen={open} />}
                aboveRows={timeline ? <AuditTimeline filterQuery={timelineQuery} pick={pick} onPick={setPick} /> : undefined}
                hideRows={timeline && !pick}
                toolbarExtra={
                    <>
                        {!timeline && (
                            <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
                                <SelectTrigger size="sm" className="min-w-36 gap-2 text-xs" aria-label="How far back the list reaches">
                                    <CalendarRange className="size-3.5 text-muted-foreground" aria-hidden="true" />
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PERIODS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        )}
                        <QuickFilter
                            aria-label="Filter the entries"
                            value={quick}
                            onChange={setQuick}
                            options={[
                                { value: "all", label: "All", count: counts?.all ?? 0 },
                                { value: "changes", label: "Changes", count: counts?.changes ?? 0 },
                                { value: "signins", label: "Sign-ins", count: counts?.signins ?? 0 },
                                { value: "sensitive", label: "Sensitive", count: counts?.sensitive ?? 0, ...((counts?.sensitive ?? 0) > 0 ? { dot: "bg-warning" } : {}) },
                            ]}
                        />
                        {record && <PickChip label={`Only ${record.label}`} count={list.total} onClear={() => setRecord(null)} icon={ListFilter} />}
                        {timeline && pick && <PickChip label={pickLabel} count={list.total} onClear={() => setPick(null)} />}
                    </>
                }
            />

            <AuditDetails
                open={details?.open ?? false}
                row={details?.row ?? null}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onRecord={(row) => {
                    if (!row.resourceId) return;
                    const name = row.parts.find((part) => part.strong)?.text ?? "this record";
                    setRecord({ resource: row.resource, resourceId: row.resourceId, label: name });
                    setDetails((current) => current && { ...current, open: false });
                }}
                canSignOut={canSignOut}
            />
        </div>
    );
}
