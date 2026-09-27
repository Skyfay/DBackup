"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Eye, ScrollText } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { DataTable, type DataTableFilterableColumn } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import { filterText, filterValues, usePagedList, type PagedQuery } from "@/hooks/use-paged-list";
import { NotificationsStrip } from "./history-strips";
import { ChannelTile, NotificationCard, notificationColumns } from "./notification-cells";
import { NotificationPanel } from "./notification-panel";
import { eventLabel, type NotificationLogRow, type NotificationPage } from "./notification-types";
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
    if (quick === "failed") params.append("status", "Failed");
    const search = filterText(query.columnFilters, "title");
    if (search) params.set("search", search);
    const response = await fetch(`/api/notification-logs?${params.toString()}`);
    if (!response.ok) throw new Error(`The notifications request failed with ${response.status}`);
    const body = await response.json();
    return { rows: body.data, total: body.total, facets: body.facets, stats: body.stats, options: body.options };
}

function filtersOf(page: NotificationPage | null): DataTableFilterableColumn<NotificationLogRow>[] {
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
    ];
}

/** Every message DBackup sent, a page at a time. A click opens the message in the side panel. */
export function NotificationsTab({ cards }: { cards: boolean }) {
    const router = useRouter();
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

    const groupsFor = useCallback((row: NotificationLogRow): BackupActionGroup[] => [{
        actions: [
            { id: "show", label: "Show message", icon: Eye, onSelect: () => setOpen(row), tone: "neutral" },
            ...(row.executionId ? [{ id: "run", label: "Open run", icon: ScrollText, onSelect: () => router.push(runHref(row.executionId!)), tone: "neutral" as const }] : []),
            { id: "channel", label: "Open channel", icon: ArrowUpRight, onSelect: () => router.push("/dashboard/connections?tab=notifications"), tone: "neutral" },
        ],
    }], [router]);

    const columns = useMemo(() => notificationColumns((row) => <BackupRowMenu name={row.title} groups={groupsFor(row)} />), [groupsFor]);
    const filters = useMemo(() => filtersOf(page), [page]);
    const statuses = page?.facets?.status ?? {};
    const all = Object.values(statuses).reduce((sum, count) => sum + count, 0);

    return (
        <div className="space-y-4 md:space-y-6">
            <NotificationsStrip stats={page?.stats ?? null} />
            <DataTable
                variant="card"
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
                getRowId={(row) => row.id}
                onRowClick={setOpen}
                activeRowId={open?.id ?? null}
                view={cards ? "cards" : "table"}
                renderCard={(row) => <NotificationCard row={row.original} onOpen={() => setOpen(row.original)} actions={<BackupRowMenu name={row.original.title} groups={groupsFor(row.original)} />} />}
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
                    <BackupContextMenu tile={<ChannelTile adapterId={row.adapterId} />} title={row.title} note={row.channelName} groups={groupsFor(row)} bulk={null} />
                )}
            />
            <NotificationPanel entry={open} onClose={() => setOpen(null)} />
        </div>
    );
}
