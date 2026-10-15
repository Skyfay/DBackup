"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SortingState } from "@tanstack/react-table";
import { Activity, Boxes, CircleArrowUp, Database, Server, TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { kindNames } from "@/components/adapter/connection-columns";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { DestinationTile } from "@/components/dashboard/storage/explorer/explorer-cells";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { useOpenRecord } from "@/components/tenant/tenant-actions";
import { useTenantColumns } from "@/components/tenant/tenant-column";
import { withTenantColumn } from "@/components/tenant/tenant-rows";
import { DataTable, type DataTableFilterableColumn } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import type { DatabaseOverview, ServersOverview } from "@/services/databases/database-explorer-types";
import { engineOf } from "./database-columns";
import { useDatabaseData } from "./database-data";
import { serverActions } from "./explorer-actions";
import { ServerCard } from "./server-card";
import { serverColumns } from "./server-columns";
import { matchesQuick, serverHref, serverRows, serversSummary, type ServerQuick, type ServerRow } from "./server-model";

const QUICK: { value: ServerQuick; label: string; dot?: string }[] = [
    { value: "all", label: "All" },
    { value: "behind", label: "Behind", dot: "bg-warning" },
    { value: "uncovered", label: "Not all backed up" },
];

const tenantOfServer = (row: ServerRow) => row.server.tenantId;

interface ServersTabProps {
    overview: DatabaseOverview;
    canOpenBackups: boolean;
    /** A phone, which gets cards instead of the table. */
    cards: boolean;
}

/**
 * The Servers tab of the Database Explorer: every database server with its version, how much of
 * it a job backs up, its kept backups and how it answers. A server behind a newer backup of its
 * engine is marked, since a backup restores only onto the same version or a newer one. A click
 * opens the page of the server.
 */
export function ServersTab({ overview, canOpenBackups, cards }: ServersTabProps) {
    const router = useRouter();
    const loaded = useDatabaseData<ServersOverview>("/api/databases/servers", "The servers could not be loaded.");
    const [quick, setQuick] = useState<ServerQuick>("all");
    const [sorting, setSorting] = useState<SortingState>([{ id: "server", desc: false }]);

    const rows = useMemo(() => serverRows(overview, loaded.data), [overview, loaded.data]);
    const shown = useMemo(() => rows.filter((row) => matchesQuick(row, quick)), [rows, quick]);
    const summary = serversSummary(rows);
    const coverage = overview.coverage;
    const backups = loaded.data?.backups ?? false;
    // In All tenants the list holds the servers of every tenant, and one opens in its tenant.
    const { allTenants, nameOf, column: tenantColumn, filter: tenantFilter } = useTenantColumns(tenantOfServer, rows);
    const openRecord = useOpenRecord();
    const open = useCallback((row: ServerRow) => {
        const href = serverHref(row.server.id);
        openRecord(row.server.tenantId, href, () => router.push(href));
    }, [openRecord, router]);
    const tenantName = useCallback((row: ServerRow) => (allTenants ? nameOf(row.server.tenantId) : null), [allTenants, nameOf]);

    const groupsFor = useCallback((row: ServerRow) => serverActions(row.jobIds, {
        coverage,
        canOpenBackups,
        tenantName: tenantName(row),
        onOpen: () => open(row),
        go: (href) => router.push(href),
    }), [open, tenantName, coverage, canOpenBackups, router]);

    const columns = useMemo(() => withTenantColumn(serverColumns({
        coverage,
        backups,
        biggest: Math.max(0, ...rows.map((row) => row.size ?? 0)),
        renderActions: (row) => <BackupRowMenu name={row.server.name} groups={groupsFor(row)} />,
    }), tenantColumn), [coverage, backups, rows, groupsFor, tenantColumn]);

    const filterableColumns = useMemo<DataTableFilterableColumn<ServerRow>[]>(() => {
        const engines = [...new Set(rows.map((row) => row.server.adapterId))];
        // The numbers come from the table, so they count what the quick filter and the search leave.
        const byEngine: DataTableFilterableColumn<ServerRow> = {
            id: "engine",
            title: "Engine",
            note: "The numbers count the servers",
            unavailableLabel: "No servers with the other filters",
            options: engines.map((adapterId) => ({
                value: adapterId,
                label: kindNames.get(adapterId) ?? adapterId,
                lead: <AdapterIcon adapterId={adapterId} className="size-4 shrink-0" />,
            })),
        };
        return tenantFilter ? [byEngine, tenantFilter] : [byEngine];
    }, [rows, tenantFilter]);

    const behind = summary.behind[0];
    return (
        <div className="space-y-4 md:space-y-0">
            <ExplorerStrip
                joined
                cells={[
                    { label: "Servers", icon: Server, value: summary.servers.toLocaleString(), extra: `on ${count(summary.engines, "engine")}` },
                    { label: "Databases", icon: Database, value: summary.databases.toLocaleString(), extra: coverage ? `${summary.covered.toLocaleString()} in a job` : "as the servers list them" },
                    { label: "New versions", icon: CircleArrowUp, value: loaded.data ? loaded.data.newVersions.toLocaleString() : "-", extra: "in the last 30 days" },
                    backups
                        ? {
                            label: "Behind",
                            icon: TriangleAlert,
                            value: summary.behind.length.toLocaleString(),
                            tone: summary.behind.length > 0 ? "warning" : undefined,
                            extra: behind ? `${behind.server.name} takes not every backup of its engine` : "every server takes the backups of its engine",
                        }
                        : { label: "Engines", icon: Boxes, value: summary.engines.toLocaleString(), extra: "kinds of database" },
                    {
                        label: "Online",
                        icon: Activity,
                        value: summary.online.toLocaleString(),
                        unit: `of ${summary.servers.toLocaleString()}`,
                        tone: summary.online < summary.servers ? "warning" : undefined,
                        extra: summary.online < summary.servers ? `${count(summary.servers - summary.online, "server")} not answering` : "every server answers",
                    },
                ]}
            />

            <DataTable
                joined
                columns={columns}
                data={shown}
                searchKey="server"
                searchPlaceholder="Search servers"
                filterableColumns={filterableColumns}
                initialColumnVisibility={{ engine: false }}
                sorting={sorting}
                onSortingChange={setSorting}
                onRefresh={loaded.reload}
                isLoading={loaded.reloading}
                getRowId={(row) => row.server.id}
                onRowClick={open}
                view={cards ? "cards" : "table"}
                renderCard={(row) => (
                    <ServerCard
                        row={row.original}
                        coverage={coverage}
                        backups={backups}
                        href={serverHref(row.original.server.id)}
                        actions={<BackupRowMenu name={row.original.server.name} groups={groupsFor(row.original)} />}
                        tenantName={tenantName(row.original)}
                    />
                )}
                toolbarExtra={(
                    <QuickFilter
                        aria-label="Filter the servers"
                        value={quick}
                        onChange={setQuick}
                        options={QUICK.filter((option) => backups || option.value !== "behind").filter((option) => coverage || option.value !== "uncovered")
                            .map((option) => ({ ...option, count: rows.filter((row) => matchesQuick(row, option.value)).length }))}
                    />
                )}
                renderRowMenu={(row) => (
                    <BackupContextMenu
                        tile={<DestinationTile destination={{ adapterId: row.server.adapterId }} />}
                        title={row.server.name}
                        note={[engineOf(row.server), tenantName(row)].filter(Boolean).join(" · ")}
                        groups={groupsFor(row)}
                        bulk={null}
                    />
                )}
            />
        </div>
    );
}
