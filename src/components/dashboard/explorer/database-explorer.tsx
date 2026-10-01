"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";
import { ArrowRight, CalendarClock, Database, Layers, RefreshCw, Server, ShieldCheck, ShieldOff, Table2 } from "lucide-react";
import { toast } from "sonner";
import { saveViewLayout } from "@/app/actions/auth/table-preferences";
import { kindNames } from "@/components/adapter/connection-columns";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { DestinationTile } from "@/components/dashboard/storage/explorer/explorer-cells";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ViewSwitch } from "@/components/ui/view-switch";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useIsMobileState } from "@/hooks/use-mobile";
import type { ViewMode } from "@/lib/core/table-preferences";
import { cn, formatBytes } from "@/lib/utils";
import type { DatabaseOverview, ExplorerDatabase } from "@/services/databases/database-explorer-types";
import { databaseColumns, engineOf } from "./database-columns";
import { backupsHref, readNow, useDatabaseData } from "./database-data";
import { DatabaseDayPanel, type DayPanelAccess, type DayPick } from "./database-day-panel";
import { DatabaseCard, DatabasesEmpty, DatabasesSkeleton, databaseFilters } from "./database-list-parts";
import { databaseHref, explorerAttention, freshnessOf, summarize } from "./database-model";
import { DatabasesTimeline } from "./databases-timeline";
import { DATABASES_PAGE_ID } from "./explorer-ids";
import { ExplorerTabs, type ExplorerTab } from "./explorer-tabs";
import { ServerFreshness } from "./server-freshness";
import { ServersTab } from "./servers-tab";

const VIEWS: ViewMode[] = ["table", "timeline"];

interface DatabaseExplorerProps extends DayPanelAccess {
    /** The view this user picked last, table or timeline. */
    initialView: ViewMode;
}

/**
 * The Database Explorer. Its Databases tab lists every database of every server with the jobs that
 * back it up, as a table or by day, and a Redis or Valkey server as one entry. A click opens a
 * database as a page of its own, with its tables and their rows read live, and a day of the
 * timeline shows its backups in a panel beside it. The Servers tab lists the servers, see
 * `ServersTab`. The list comes from what DBackup read from the servers last, so the page opens
 * without asking one. The tab and the picked day live in the address.
 */
export function DatabaseExplorer({ initialView, ...access }: DatabaseExplorerProps) {
    const { canOpenBackups } = access;
    const router = useRouter();
    const searchParams = useSearchParams();
    const overview = useDatabaseData<DatabaseOverview>("/api/databases");
    const data = overview.data;
    const [view, setView] = useState<ViewMode>(VIEWS.includes(initialView) ? initialView : "table");
    const [sorting, setSorting] = useState<SortingState>([{ id: "size", desc: true }]);
    // A link from a connection names it, and the list starts filtered to its databases.
    const [filters, setFilters] = useState<ColumnFiltersState>(() => {
        const sourceId = searchParams.get("sourceId");
        return sourceId ? [{ id: "server", value: [sourceId] }] : [];
    });
    const open = useCallback((database: ExplorerDatabase) => router.push(databaseHref(database)), [router]);
    const tab: ExplorerTab = searchParams.get("tab") === "servers" ? "servers" : "databases";
    const setTab = (next: ExplorerTab) => router.replace(next === "servers" ? "/dashboard/explorer?tab=servers" : "/dashboard/explorer", { scroll: false });

    const pickKey = searchParams.get("database");
    const pickDay = searchParams.get("day");
    const pick: DayPick | null = pickKey && pickDay ? { key: pickKey, day: pickDay, run: searchParams.get("run") } : null;
    const setPick = useCallback((next: DayPick | null) => {
        const params = new URLSearchParams(searchParams.toString());
        for (const name of ["database", "day", "run"]) params.delete(name);
        if (next) {
            params.set("database", next.key);
            params.set("day", next.day);
            if (next.run) params.set("run", next.run);
        }
        const query = params.toString();
        router.replace(query ? `/dashboard/explorer?${query}` : "/dashboard/explorer", { scroll: false });
    }, [router, searchParams]);
    // From xl the panel sits beside the timeline, on smaller screens the timeline needs the width.
    const docked = useMediaQuery("(min-width: 1280px)");

    const isMobile = useIsMobileState();
    const coverage = data?.coverage ?? false;
    const shownView = isMobile === undefined ? undefined : isMobile ? "cards" : coverage ? view : "table";
    const changeView = useCallback((next: ViewMode) => {
        setView(next);
        saveViewLayout(DATABASES_PAGE_ID, next)
            .then((result) => result.success)
            .catch(() => false)
            .then((saved) => {
                if (!saved) toast.error("Your view could not be saved.");
            });
    }, []);

    const serversById = useMemo(() => new Map((data?.servers ?? []).map((server) => [server.id, server])), [data]);
    const jobsById = useMemo(() => new Map((data?.jobs ?? []).map((job) => [job.id, job])), [data]);
    const summary = useMemo(() => (data ? summarize(data) : null), [data]);

    const groupsFor = useCallback((database: ExplorerDatabase): BackupActionGroup[] => [{
        actions: [
            { id: "open", label: "Open", icon: Database, onSelect: () => open(database), tone: "neutral" },
            ...(coverage && canOpenBackups && database.jobIds.length > 0
                ? [{ id: "backups", label: "Open backups", icon: ArrowRight, onSelect: () => router.push(backupsHref(database.jobIds)), tone: "neutral" as const }]
                : []),
            ...(coverage
                ? [{
                    id: "jobs",
                    label: database.jobIds.length === 0 ? "Open jobs" : "Open job",
                    icon: CalendarClock,
                    onSelect: () => router.push(database.jobIds.length > 0 ? `/dashboard/jobs?job=${encodeURIComponent(database.jobIds[0])}` : "/dashboard/jobs"),
                    tone: "neutral" as const,
                }]
                : []),
        ],
    }], [open, coverage, canOpenBackups, router]);

    const columns = useMemo(() => databaseColumns({
        serversById,
        jobsById,
        coverage,
        biggest: summary?.biggest?.sizeInBytes ?? 0,
        renderActions: (database) => <BackupRowMenu name={database.name} groups={groupsFor(database)} />,
    }), [serversById, jobsById, coverage, summary, groupsFor]);
    const filterableColumns = useMemo(() => (data ? databaseFilters(data) : []), [data]);

    const { reload } = overview;
    const read = useCallback(async () => {
        try {
            await readNow();
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "The servers could not be read.");
        }
        reload();
    }, [reload]);

    // Waits for the measured screen too, so a phone never flashes the table before its cards.
    if (overview.loading || isMobile === undefined) return <DatabasesSkeleton />;
    if (!data || !summary) {
        return (
            <DatabasesEmpty title="The databases could not be loaded">
                {overview.error ?? "Something went wrong."}{" "}
                <Button variant="link" className="h-auto p-0" onClick={overview.reload}>Try again</Button>
            </DatabasesEmpty>
        );
    }
    if (data.servers.length === 0) {
        return <DatabasesEmpty title="No database connections yet">Add a database on the Connections page, then its databases show here with the jobs that back them up.</DatabasesEmpty>;
    }

    const dayPanel = pick && shownView === "timeline"
        ? (frame: "docked" | "sheet") => (
            <DatabaseDayPanel
                frame={frame}
                pick={pick}
                overview={data}
                access={access}
                onRun={(run) => setPick({ ...pick, run })}
                onShow={(day, run) => setPick({ key: pick.key, day, run })}
                onClose={() => setPick(null)}
            />
        )
        : null;
    const [storedValue, storedUnit] = formatBytes(summary.size, 1).split(" ");
    const oldestRead = freshnessOf(data.servers).oldest;
    const neverRead = data.databases.length === 0 && data.servers.every((server) => !server.readAt);
    // The keys of an instance are no tables.
    const keyStores = [...new Set(data.databases.filter((database) => database.kind === "instance").map((database) => serversById.get(database.serverId)?.adapterId ?? ""))]
        .map((adapterId) => kindNames.get(adapterId) ?? adapterId);

    // The day beside the timeline docks beside the whole card, tabs and numbers included, from xl up.
    const dayBeside = tab === "databases" && !neverRead && dayPanel && docked;

    return (
        <div className={cn(dayBeside && "flex items-start gap-4 md:gap-6")}>
            <div className="min-w-0 flex-1 space-y-4 md:space-y-0">
                <ExplorerTabs tab={tab} attention={explorerAttention(data, summary, coverage)} onTab={setTab}>
                    <ServerFreshness servers={data.servers} onReadNow={read} />
                    {coverage && tab === "databases" && (
                        // Hidden by CSS rather than by the measured screen, so it does not pop in after loading.
                        <div className="hidden md:block">
                            <ViewSwitch value={view} onChange={changeView} views={VIEWS} />
                        </div>
                    )}
                </ExplorerTabs>

                {tab === "servers" ? (
                    <ServersTab overview={data} canOpenBackups={canOpenBackups} cards={isMobile} />
                ) : neverRead ? (
                    <DatabasesEmpty joined title="The servers have not been read yet">
                        DBackup reads the databases of every server once an hour.{" "}
                        <Button variant="link" className="h-auto p-0" onClick={() => void read()}>Read them now</Button>
                    </DatabasesEmpty>
                ) : (
                    <>
                        <ExplorerStrip
                            joined
                            cells={[
                                { label: "Databases", icon: Database, value: summary.databases.toLocaleString(), extra: `on ${count(summary.servers, "server")}` },
                                {
                                    label: "Stored",
                                    icon: Layers,
                                    value: storedValue,
                                    unit: storedUnit,
                                    extra: summary.unsized > 0 ? `${count(summary.unsized, "database")} without a size` : summary.biggest ? `${summary.biggest.name} is ${formatBytes(summary.biggest.sizeInBytes ?? 0)} of it` : undefined,
                                },
                                { label: "Tables", icon: Table2, value: summary.tables.toLocaleString(), extra: keyStores.length > 0 ? `the keys of ${keyStores.join(" and ")} aside` : "as the servers list them" },
                                coverage
                                    ? { label: "Backed up", icon: ShieldCheck, value: summary.backedUp.toLocaleString(), unit: `of ${summary.databases.toLocaleString()}`, extra: `by ${count(data.jobs.filter((job) => job.enabled).length, "job")}` }
                                    : { label: "Servers", icon: Server, value: summary.servers.toLocaleString(), extra: "database connections" },
                                coverage
                                    ? {
                                        label: "In no job",
                                        icon: ShieldOff,
                                        value: summary.noJob.toLocaleString(),
                                        tone: summary.noJob > 0 ? "warning" : undefined,
                                        extra: summary.noJob > 0 ? `${formatBytes(summary.noJobSize)} no job backs up` : "every database is in a job",
                                    }
                                    : { label: "Read", icon: RefreshCw, value: oldestRead ? <RelativeTime date={oldestRead} /> : "-", extra: "from the servers, the oldest list" },
                            ]}
                        />

                        <DataTable
                            joined
                            columns={columns}
                            data={data.databases}
                            searchKey="database"
                            searchPlaceholder="Search databases"
                            filterableColumns={filterableColumns}
                            initialColumnVisibility={{ server: false, engine: false, job: false, state: false }}
                            columnFilters={filters}
                            onColumnFiltersChange={setFilters}
                            sorting={sorting}
                            onSortingChange={setSorting}
                            onRefresh={overview.reload}
                            isLoading={overview.reloading}
                            getRowId={(database) => database.key}
                            onRowClick={open}
                            view={shownView === "cards" ? "cards" : "table"}
                            renderCard={(row) => (
                                <DatabaseCard
                                    database={row.original}
                                    server={serversById.get(row.original.serverId)}
                                    jobsById={jobsById}
                                    coverage={coverage}
                                    href={databaseHref(row.original)}
                                    actions={<BackupRowMenu name={row.original.name} groups={groupsFor(row.original)} />}
                                />
                            )}
                            renderRowMenu={(database) => (
                                <BackupContextMenu
                                    tile={<DestinationTile destination={{ adapterId: serversById.get(database.serverId)?.adapterId ?? "" }} />}
                                    title={database.name}
                                    note={database.kind === "instance" ? engineOf(serversById.get(database.serverId)) : `${serversById.get(database.serverId)?.name ?? ""} · ${engineOf(serversById.get(database.serverId))}`}
                                    groups={groupsFor(database)}
                                    bulk={null}
                                />
                            )}
                            aboveRows={shownView === "timeline"
                                ? (rows) => (
                                    <DatabasesTimeline
                                        databases={rows.map((row) => row.original)}
                                        servers={data.servers}
                                        jobs={data.jobs}
                                        picked={pick}
                                        onPick={(key, day) => setPick(pick?.key === key && pick.day === day ? null : { key, day, run: null })}
                                    />
                                )
                                : undefined}
                            hideRows={shownView === "timeline"}
                        />
                        {dayPanel && !docked && (
                            <Sheet open onOpenChange={(next) => !next && setPick(null)}>
                                <SheetContent side="right" showCloseButton={false} aria-describedby={undefined} className="w-full gap-0 p-0 sm:max-w-xl">
                                    <SheetTitle className="sr-only">Backups of the day</SheetTitle>
                                    {dayPanel("sheet")}
                                </SheetContent>
                            </Sheet>
                        )}

                    </>
                )}
            </div>
            {dayBeside && (
                // Stays in view while the timeline scrolls, as high as the window below the header.
                <aside aria-label="Backups of the day" className="sticky top-6 h-[calc(100svh-6.75rem)] w-[30rem] shrink-0 2xl:w-[34rem]">
                    {dayPanel("docked")}
                </aside>
            )}
        </div>
    );
}
