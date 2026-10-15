"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Building2, CalendarClock, Play, ScrollText, Square } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { DataTable } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import { useOpenRecord } from "@/components/tenant/tenant-actions";
import { useTenantColumns } from "@/components/tenant/tenant-column";
import { TENANT_COLUMN_ID, withTenantColumn } from "@/components/tenant/tenant-rows";
import { filterText, filterValues, usePagedList, type PagedQuery } from "@/hooks/use-paged-list";
import type { RunPage, RunRow } from "@/services/history/run-types";
import { CancelRunDialog } from "./cancel-run-dialog";
import { RunsStrip } from "./history-strips";
import { startRun } from "./run-actions";
import { RunCard } from "./run-card";
import { RunTile } from "./run-cells";
import { runColumns } from "./run-columns";
import { runFilters } from "./run-filters";
import { isLive, QUICK_STATUSES, typeLabel, type RunQuick } from "./run-format";
import { runHref } from "./run-links";
import { useNow } from "./use-now";

export interface RunsAccess {
    canExecute: boolean;
    canOpenJobs: boolean;
    canOpenBackups: boolean;
}

async function loadRuns(query: PagedQuery, quick: RunQuick): Promise<RunPage> {
    const params = new URLSearchParams();
    params.set("page", String(query.pagination.pageIndex + 1));
    params.set("pageSize", String(query.pagination.pageSize));
    // The Tenant filter only exists in All tenants, where the server narrows by it.
    for (const [id, name] of [["type", "type"], ["job", "job"], ["by", "by"], [TENANT_COLUMN_ID, "tenant"]] as const) {
        for (const value of filterValues(query.columnFilters, id)) params.append(name, value);
    }
    for (const status of QUICK_STATUSES[quick]) params.append("status", status);
    const search = filterText(query.columnFilters, "run");
    if (search) params.set("search", search);
    const response = await fetch(`/api/history/runs?${params.toString()}`);
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.error ?? `The runs request failed with ${response.status}`);
    return body.data as RunPage;
}

const tenantOfRun = (row: RunRow) => row.tenantId;

/**
 * Every run of DBackup, backups, restores and the system tasks in one list, a page at a time from
 * the server. The numbers above it cover the last 30 days, a click opens the page of a run.
 *
 * In All tenants the list holds the runs of every tenant with their tenant. A run still opens as
 * its page, which reads fine there, and Open in its tenant opens it where it can be run again or
 * cancelled.
 */
export function RunsTab({ cards, access }: { cards: boolean; access: RunsAccess }) {
    const router = useRouter();
    // Without rows, since the server pages the list, the Tenant filter offers every tenant.
    const { allTenants, nameOf, column: tenantColumn, filter: tenantFilter } = useTenantColumns(tenantOfRun);
    const openRecord = useOpenRecord();
    // Nothing of a tenant changes in All tenants. Its permissions lack the right to run jobs anyway.
    const canExecute = access.canExecute && !allTenants;
    const [quick, setQuick] = useState<RunQuick>("all");
    const [page, setPage] = useState<RunPage | null>(null);
    const [pollMs, setPollMs] = useState(5000);
    const [cancelling, setCancelling] = useState<RunRow | null>(null);

    const load = useCallback(async (query: PagedQuery) => {
        const data = await loadRuns(query, quick);
        setPage(data);
        // A live run on the page is followed closely, the rest of the list at an easy pace.
        setPollMs(data.rows.some(isLive) ? 2000 : 5000);
        return { rows: data.rows, total: data.total };
    }, [quick]);
    const list = usePagedList<RunRow>({ load, enabled: true, pollMs });
    const { setPagination } = list;
    const now = useNow(list.rows.some(isLive));

    // A new quick filter narrows the list, so the page it was on means nothing anymore.
    useEffect(() => {
        setPagination((previous) => (previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 }));
    }, [quick, setPagination]);

    const open = useCallback((row: RunRow) => router.push(runHref(row.id)), [router]);
    const groupsFor = useCallback((row: RunRow): BackupActionGroup[] => {
        const live = isLive(row);
        const tenantName = allTenants ? nameOf(row.tenantId) : null;
        return [{
            actions: [
                { id: "open", label: "Open run", icon: ScrollText, onSelect: () => open(row), tone: "neutral" },
                ...(tenantName
                    ? [{ id: "open-in-tenant", label: `Open in ${tenantName}`, icon: Building2, onSelect: () => openRecord(row.tenantId, runHref(row.id), () => open(row)), tone: "neutral" as const }]
                    : []),
                ...(row.jobId && access.canOpenJobs
                    ? [{ id: "job", label: "Open job", icon: CalendarClock, onSelect: () => router.push(`/dashboard/jobs?job=${encodeURIComponent(row.jobId!)}`), tone: "neutral" as const }]
                    : []),
                ...(row.jobId && row.type === "Backup" && access.canOpenBackups
                    ? [{ id: "backups", label: "Open backups", icon: Archive, onSelect: () => router.push(`/dashboard/backups?job=${encodeURIComponent(row.jobId!)}`), tone: "neutral" as const }]
                    : []),
                ...(row.jobId && row.type === "Backup" && canExecute && !live
                    ? [{ id: "again", label: "Run again", icon: Play, onSelect: () => void startRun(row.jobId!, row.name).then(() => list.refresh()), tone: "neutral" as const }]
                    : []),
                ...(live && canExecute
                    ? [{ id: "cancel", label: "Cancel run", icon: Square, onSelect: () => setCancelling(row), tone: "destructive" as const }]
                    : []),
            ],
        }];
    }, [access, canExecute, allTenants, nameOf, open, openRecord, router, list]);

    const columns = useMemo(
        () => withTenantColumn(runColumns({ now, renderActions: (row) => <BackupRowMenu name={row.name} groups={groupsFor(row)} /> }), tenantColumn),
        [now, groupsFor, tenantColumn]
    );
    const filters = useMemo(() => runFilters(page, tenantFilter ? { filter: tenantFilter, nameOf } : null), [page, tenantFilter, nameOf]);
    const status = page?.facets.status ?? {};
    const quickCount = (value: RunQuick) => !page
        ? undefined
        : value === "all"
            ? Object.values(status).reduce((sum, count) => sum + count, 0)
            : QUICK_STATUSES[value].reduce((sum, key) => sum + (status[key] ?? 0), 0);

    return (
        <div className="space-y-4 md:space-y-0">
            <RunsStrip stats={page?.stats ?? null} />
            <DataTable
                joined
                columns={columns}
                data={list.rows}
                searchKey="run"
                searchPlaceholder="Search runs"
                filterableColumns={filters}
                initialColumnVisibility={{ type: false, job: false, by: false }}
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
                loadingRows={!list.loaded}
                getRowId={(row) => row.id}
                onRowClick={open}
                view={cards ? "cards" : "table"}
                renderCard={(row) => (
                    <RunCard
                        row={row.original}
                        href={runHref(row.original.id)}
                        now={now}
                        actions={<BackupRowMenu name={row.original.name} groups={groupsFor(row.original)} />}
                        tenantName={allTenants ? nameOf(row.original.tenantId) : null}
                    />
                )}
                toolbarExtra={(
                    <QuickFilter
                        aria-label="Filter the runs"
                        value={quick}
                        onChange={setQuick}
                        options={[
                            { value: "all", label: "All", count: quickCount("all") },
                            { value: "failed", label: "Failed", dot: "bg-destructive", count: quickCount("failed") },
                            { value: "partial", label: "Partial", dot: "bg-warning", count: quickCount("partial") },
                            { value: "running", label: "Running", dot: "bg-muted-foreground", count: quickCount("running") },
                        ]}
                    />
                )}
                renderRowMenu={(row) => (
                    <BackupContextMenu
                        tile={<RunTile row={row} />}
                        title={row.name}
                        note={[typeLabel(row.type), row.starter.label, allTenants ? nameOf(row.tenantId) : null].filter(Boolean).join(" · ")}
                        groups={groupsFor(row)}
                        bulk={null}
                    />
                )}
            />
            <CancelRunDialog run={cancelling} onClose={() => setCancelling(null)} onCancelled={() => void list.refresh()} />
        </div>
    );
}
