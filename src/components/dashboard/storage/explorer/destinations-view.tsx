"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SortingState } from "@tanstack/react-table";
import { ArrowRight, PanelBottomClose, PanelBottomOpen, RefreshCw } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { kindNames } from "@/components/adapter/connection-columns";
import { signedBytes } from "@/components/dashboard/widgets/storage-history-data";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableFilterableColumn } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatBytes } from "@/lib/utils";
import type { BackupRun, ExplorerDestination, ExplorerJob, ExplorerPlan } from "@/services/storage/explorer-types";
import type { BackupActionGroup } from "./backup-actions";
import { BackupContextMenu, BackupRowMenu } from "./backup-menus";
import { DestinationCard } from "./destination-card";
import { destinationColumns } from "./destination-columns";
import { DestinationDetails } from "./destination-details";
import { statesOfDestination, summarizeDestinations, type DestinationState } from "./destination-model";
import { DestinationsTimeline } from "./destinations-timeline";
import { DestinationTile } from "./explorer-cells";
import { count } from "./explorer-format";
import { ExplorerStrip } from "./explorer-strip";
import type { BackupTarget } from "./use-backup-actions";

const STATES: { value: DestinationState; label: string; dot?: string }[] = [
    { value: "online", label: "Answers right now", dot: "bg-success" },
    { value: "missed", label: "Missed its last check", dot: "bg-warning" },
    { value: "offline", label: "Offline", dot: "bg-destructive" },
    { value: "behind", label: "Its list is old" },
    { value: "alert", label: "An alert fires" },
];

/** Holds the place of what needs every backup while they load, or says why they did not. */
function RunsPending({ error, onRetry, className }: { error: string | null; onRetry: () => void; className: string }) {
    if (!error) return <Skeleton className={cn("w-full", className)} />;
    return (
        <div className={cn("flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 text-center text-sm", className)}>
            <p className="font-medium">The backups could not be loaded</p>
            <p className="text-muted-foreground">
                {error}{" "}
                <Button variant="link" className="h-auto p-0" onClick={onRetry}>Try again</Button>
            </p>
        </div>
    );
}

interface DestinationsViewProps {
    destinations: ExplorerDestination[];
    destinationsById: Map<string, ExplorerDestination>;
    jobs: ExplorerJob[];
    /** Every backup with its copies, null while they load. */
    runs: BackupRun[] | null;
    /** Why the backups could not be loaded. */
    runsError: string | null;
    /** What the schedules plan, for the timeline. Null while it loads or in the table. */
    plan: ExplorerPlan | null;
    /** A phone gets the cards. */
    view: "table" | "timeline" | "cards";
    /** The destination whose details show under the list. */
    picked: string | null;
    onPick: (destinationId: string | null) => void;
    /** Shows the backups at a destination in the Backups tab. */
    onOpenBackups: (destinationId: string) => void;
    canDelete: boolean;
    canEditAlerts: boolean;
    onCheckNow: (destination: ExplorerDestination) => void;
    askDelete: (targets: BackupTarget[], title?: string) => void;
    onRefresh: () => void;
    refreshing: boolean;
    onChanged: () => void;
}

/**
 * The Destinations tab: every destination with how it is doing, as a table or by day. A click
 * shows the details of one under the list, as wide as the page. Its backups are the Backups tab
 * with the destination as a filter.
 */
export function DestinationsView(props: DestinationsViewProps) {
    const { destinations, destinationsById, jobs, runs, runsError, plan, view, picked, onPick, onOpenBackups, canDelete, canEditAlerts, onCheckNow, askDelete, onRefresh, refreshing, onChanged } = props;
    const [sorting, setSorting] = useState<SortingState>([]);
    const detailsRef = useRef<HTMLDivElement>(null);
    const summary = useMemo(() => summarizeDestinations(destinations), [destinations]);
    const pickedDestination = picked ? destinationsById.get(picked) ?? null : null;
    const toggle = useCallback((destinationId: string) => onPick(picked === destinationId ? null : destinationId), [picked, onPick]);

    // The details open under the list, so the page moves to them.
    useEffect(() => {
        if (picked) detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [picked]);

    // What a destination offers, once for the button at the end of its row and its right click.
    const groupsFor = useCallback((destination: ExplorerDestination): BackupActionGroup[] => [{
        actions: [
            picked === destination.id
                ? { id: "hide", label: "Hide details", icon: PanelBottomClose, onSelect: () => onPick(null), tone: "neutral" }
                : { id: "show", label: "Show details", icon: PanelBottomOpen, onSelect: () => onPick(destination.id), tone: "neutral" },
            { id: "backups", label: "Open backups", icon: ArrowRight, onSelect: () => onOpenBackups(destination.id), tone: "neutral" },
            { id: "check", label: "Check now", icon: RefreshCw, onSelect: () => onCheckNow(destination), tone: "neutral" },
        ],
    }], [picked, onPick, onOpenBackups, onCheckNow]);

    const columns = useMemo(() => destinationColumns({
        jobs,
        renderActions: (destination) => <BackupRowMenu name={destination.name} groups={groupsFor(destination)} />,
    }), [jobs, groupsFor]);

    const filterableColumns = useMemo<DataTableFilterableColumn<ExplorerDestination>[]>(() => {
        const kinds = [...new Set(destinations.map((destination) => destination.adapterId))];
        const note = "The numbers count the destinations";
        return [
            {
                id: "type",
                title: "Type",
                note,
                options: kinds.map((adapterId) => ({
                    value: adapterId,
                    label: kindNames.get(adapterId) ?? adapterId,
                    lead: <AdapterIcon adapterId={adapterId} className="size-4 shrink-0" />,
                    count: destinations.filter((destination) => destination.adapterId === adapterId).length,
                })),
            },
            {
                id: "state",
                title: "State",
                note,
                options: STATES.map((state) => ({
                    value: state.value,
                    label: state.label,
                    lead: state.dot ? <span className="flex size-4 shrink-0 items-center justify-center"><span className={`size-2 rounded-full ${state.dot}`} /></span> : undefined,
                    count: destinations.filter((destination) => statesOfDestination(destination).includes(state.value)).length,
                })),
            },
        ];
    }, [destinations]);

    const [storedValue, storedUnit] = formatBytes(summary.size, 1).split(" ");

    return (
        <div className="space-y-4 md:space-y-6">
            <ExplorerStrip
                cells={[
                    { label: "Destinations", value: summary.destinations.toLocaleString(), extra: `${summary.answering} answer right now` },
                    { label: "Stored", value: storedValue, unit: storedUnit, extra: `at ${count(summary.destinations, "destination")}` },
                    { label: "Last 7 days", value: summary.growth === null ? "-" : signedBytes(summary.growth), extra: summary.growth === null ? "not measured a week ago" : "grown by" },
                    { label: "Backups", value: summary.backups.toLocaleString(), extra: "copies at every destination" },
                    {
                        label: "Alerts",
                        value: summary.alerts.length.toLocaleString(),
                        unit: "active",
                        tone: summary.alerts.length > 0 ? "warning" : undefined,
                        extra: summary.alerts.length > 0 ? summary.alerts.join(", ") : "none fires",
                    },
                ]}
            />

            <DataTable
                variant="card"
                columns={columns}
                data={destinations}
                searchKey="destination"
                searchPlaceholder="Search destinations"
                filterableColumns={filterableColumns}
                initialColumnVisibility={{ type: false, state: false }}
                sorting={sorting}
                onSortingChange={setSorting}
                onRefresh={onRefresh}
                isLoading={refreshing}
                getRowId={(destination) => destination.id}
                onRowClick={(destination) => toggle(destination.id)}
                activeRowId={picked}
                view={view === "cards" ? "cards" : "table"}
                renderCard={(row) => (
                    <DestinationCard
                        destination={row.original}
                        jobs={jobs}
                        picked={picked === row.original.id}
                        onPick={(destination) => toggle(destination.id)}
                        actions={<BackupRowMenu name={row.original.name} groups={groupsFor(row.original)} />}
                    />
                )}
                renderRowMenu={(destination) => (
                    <BackupContextMenu
                        tile={<DestinationTile destination={destination} />}
                        title={destination.name}
                        note={`${kindNames.get(destination.adapterId) ?? destination.adapterId} · ${count(destination.count, "backup")}`}
                        groups={groupsFor(destination)}
                        bulk={null}
                    />
                )}
                aboveRows={view === "timeline" ? (
                    runs ? (
                        <DestinationsTimeline destinations={destinations} runs={runs} jobs={jobs} plan={plan} picked={picked} onPick={toggle} />
                    ) : (
                        <div className="p-5"><RunsPending error={runsError} onRetry={onRefresh} className="h-40" /></div>
                    )
                ) : undefined}
                hideRows={view === "timeline"}
                initialPageSize={20}
            />

            {pickedDestination && (
                <div ref={detailsRef} className="scroll-mt-4">
                    {runs ? (
                        <DestinationDetails
                            key={pickedDestination.id}
                            destination={pickedDestination}
                            runs={runs}
                            jobs={jobs}
                            destinations={destinationsById}
                            canDelete={canDelete}
                            canEditAlerts={canEditAlerts}
                            onClose={() => onPick(null)}
                            onCheckNow={() => onCheckNow(pickedDestination)}
                            onDelete={askDelete}
                            onChanged={onChanged}
                        />
                    ) : (
                        <RunsPending error={runsError} onRetry={onRefresh} className="h-64 rounded-xl" />
                    )}
                </div>
            )}
        </div>
    );
}
