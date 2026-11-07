"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Building2, Eye, ScrollText } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { DataTable, type DataTableFilterableColumn } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import { useOpenRecord } from "@/components/tenant/tenant-actions";
import { useTenantColumns } from "@/components/tenant/tenant-column";
import { TENANT_COLUMN_ID, withTenantColumn } from "@/components/tenant/tenant-rows";
import { filterText, filterValues, usePagedList, type PagedQuery } from "@/hooks/use-paged-list";
import { NotificationsStrip } from "./history-strips";
import { ChannelTile, NotificationCard, notificationColumns } from "./notification-cells";
import { NotificationPanel, type ChannelInTenant } from "./notification-panel";
import { channelHref, CHANNELS_HREF, eventLabel, type NotificationLogRow, type NotificationPage } from "./notification-types";
import { runHref } from "./run-links";

type NotificationQuick = "all" | "failed";

async function loadNotifications(query: PagedQuery, quick: NotificationQuick): Promise<NotificationPage> {
    const params = new URLSearchParams();
    params.set("page", String(query.pagination.pageIndex + 1));
    params.set("pageSize", String(query.pagination.pageSize));
    params.set("facets", "true");
    params.set("stats", "true");
    for (const value of filterValues(query.columnFilters, "channel")) params.append("channel", value);
    for (const value of filterValues(query.columnFilters, "event")) params.append("eventType", value);
    // The Tenant filter only exists in All tenants, where the server narrows by it.
    for (const value of filterValues(query.columnFilters, TENANT_COLUMN_ID)) params.append("tenant", value);
    if (quick === "failed") params.append("status", "Failed");
    const search = filterText(query.columnFilters, "title");
    if (search) params.set("search", search);
    const response = await fetch(`/api/notification-logs?${params.toString()}`);
    if (!response.ok) throw new Error(`The notifications request failed with ${response.status}`);
    const body = await response.json();
    return { rows: body.data, total: body.total, facets: body.facets, stats: body.stats, options: body.options };
}

/**
 * The filters of the notifications, and in All tenants the tenant. The numbers come from the server,
 * which counts under the other filters, the tenants included, since the list is paged there.
 */
function filtersOf(page: NotificationPage | null, tenant: DataTableFilterableColumn<NotificationLogRow> | null): DataTableFilterableColumn<NotificationLogRow>[] {
    const shared = { note: "The numbers count the notifications", unavailableLabel: "No notifications with the other filters" };
    return [
        {
            id: "channel",
            title: "Channel",
            ...shared,
            options: (page?.options?.channels ?? []).map((channel) => ({
                value: channel.name,
                label: channel.name,
                lead: <AdapterIcon adapterId={channel.adapterId} className="size-4 shrink-0" />,
                count: page?.facets?.channelName[channel.name] ?? 0,
            })),
        },
        {
            id: "event",
            title: "Event",
            ...shared,
            options: (page?.options?.events ?? []).map((event) => ({ value: event, label: eventLabel(event), count: page?.facets?.eventType[event] ?? 0 })),
        },
        ...(tenant
            ? [{ ...tenant, ...shared, options: tenant.options.map((option) => ({ ...option, count: page?.facets?.tenantId?.[option.value] ?? 0 })) }]
            : []),
    ];
}

const tenantOfLog = (row: NotificationLogRow) => row.tenantId;

/**
 * Every message DBackup sent, a page at a time. A click opens the message in the side panel. In All
 * tenants the list holds the messages of every tenant with their tenant, and the channel of one
 * opens in its tenant.
 */
export function NotificationsTab({ cards }: { cards: boolean }) {
    const router = useRouter();
    // Without rows, since the server pages the list, the Tenant filter offers every tenant.
    const { allTenants, nameOf, column: tenantColumn, filter: tenantFilter } = useTenantColumns(tenantOfLog);
    const openRecord = useOpenRecord();
    const [quick, setQuick] = useState<NotificationQuick>("all");
    const [page, setPage] = useState<NotificationPage | null>(null);
    const [open, setOpen] = useState<NotificationLogRow | null>(null);

    const load = useCallback(async (query: PagedQuery) => {
        const data = await loadNotifications(query, quick);
        setPage(data);
        return { rows: data.rows, total: data.total };
    }, [quick]);
    const list = usePagedList<NotificationLogRow>({ load, enabled: true, pollMs: 10_000 });
    const { setPagination } = list;
    useEffect(() => {
        setPagination((previous) => (previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 }));
    }, [quick, setPagination]);

    // In All tenants the channel opens in its tenant, where it can be changed, like on the Connections page.
    const channelInTenant = useCallback((row: NotificationLogRow): ChannelInTenant | null => {
        const name = allTenants ? nameOf(row.tenantId) : null;
        return name
            ? { label: `Open channel in ${name}`, onSelect: () => openRecord(row.tenantId, channelHref(row), () => router.push(CHANNELS_HREF)) }
            : null;
    }, [allTenants, nameOf, openRecord, router]);

    const groupsFor = useCallback((row: NotificationLogRow): BackupActionGroup[] => {
        const inTenant = channelInTenant(row);
        return [{
            actions: [
                { id: "show", label: "Show message", icon: Eye, onSelect: () => setOpen(row), tone: "neutral" },
                ...(row.executionId ? [{ id: "run", label: "Open run", icon: ScrollText, onSelect: () => router.push(runHref(row.executionId!)), tone: "neutral" as const }] : []),
                inTenant
                    ? { id: "channel", label: inTenant.label, icon: Building2, onSelect: inTenant.onSelect, tone: "neutral" }
                    : { id: "channel", label: "Open channel", icon: ArrowUpRight, onSelect: () => router.push(CHANNELS_HREF), tone: "neutral" },
            ],
        }];
    }, [router, channelInTenant]);

    const columns = useMemo(
        () => withTenantColumn(notificationColumns((row) => <BackupRowMenu name={row.title} groups={groupsFor(row)} />), tenantColumn),
        [groupsFor, tenantColumn]
    );
    const filters = useMemo(() => filtersOf(page, tenantFilter), [page, tenantFilter]);
    const tenantNameOf = (row: NotificationLogRow) => (allTenants ? nameOf(row.tenantId) : null);
    const statuses = page?.facets?.status ?? {};
    const all = Object.values(statuses).reduce((sum, count) => sum + count, 0);

    return (
        <div className="space-y-4 md:space-y-0">
            <NotificationsStrip stats={page?.stats ?? null} />
            <DataTable
                joined
                columns={columns}
                data={list.rows}
                searchKey="title"
                searchPlaceholder="Search notifications"
                filterableColumns={filters}
                initialColumnVisibility={{}}
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
                onRowClick={setOpen}
                activeRowId={open?.id ?? null}
                view={cards ? "cards" : "table"}
                renderCard={(row) => (
                    <NotificationCard
                        row={row.original}
                        onOpen={() => setOpen(row.original)}
                        actions={<BackupRowMenu name={row.original.title} groups={groupsFor(row.original)} />}
                        tenantName={tenantNameOf(row.original)}
                    />
                )}
                toolbarExtra={(
                    <QuickFilter
                        aria-label="Filter the notifications"
                        value={quick}
                        onChange={setQuick}
                        options={[
                            { value: "all", label: "All", count: all },
                            { value: "failed", label: "Failed", dot: "bg-destructive", count: statuses.Failed ?? 0 },
                        ]}
                    />
                )}
                renderRowMenu={(row) => (
                    <BackupContextMenu
                        tile={<ChannelTile adapterId={row.adapterId} />}
                        title={row.title}
                        note={[row.channelName, tenantNameOf(row)].filter(Boolean).join(" · ")}
                        groups={groupsFor(row)}
                        bulk={null}
                    />
                )}
            />
            <NotificationPanel
                entry={open}
                onClose={() => setOpen(null)}
                tenantName={open ? tenantNameOf(open) : null}
                channelInTenant={open ? channelInTenant(open) : null}
            />
        </div>
    );
}
