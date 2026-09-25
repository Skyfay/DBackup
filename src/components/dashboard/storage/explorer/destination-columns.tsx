"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ClockAlert } from "lucide-react";
import { kindNames } from "@/components/adapter/connection-columns";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { signedBytes } from "@/components/dashboard/widgets/storage-history-data";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import { activeAlerts, jobsOfDestination, limitShare, statesOfDestination } from "./destination-model";
import { AnswerText, DestinationTile, JobIcon } from "./explorer-cells";
import { count } from "./explorer-format";

interface ColumnsInput {
    jobs: ExplorerJob[];
    renderActions: (destination: ExplorerDestination) => React.ReactNode;
}

/** The jobs of a destination as small overlapping logos and how many there are. */
function JobsCell({ jobs }: { jobs: ExplorerJob[] }) {
    if (jobs.length === 0) return <span className="text-sm text-muted-foreground">None</span>;
    return (
        <span className="flex min-w-0 items-center">
            {jobs.slice(0, 4).map((job, index) => (
                <span key={job.key} className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted", index > 0 && "-ml-1.5")} title={job.name}>
                    <JobIcon job={job} className="size-3" />
                </span>
            ))}
            <span className="ml-2 truncate text-xs text-muted-foreground">{jobs.length === 1 ? jobs[0].name : count(jobs.length, "job")}</span>
        </span>
    );
}

/** What a destination stores and, with a limit alert on, how much of that limit it fills. */
function StoredCell({ destination }: { destination: ExplorerDestination }) {
    const share = limitShare(destination);
    return (
        <div className="min-w-0">
            <div className="flex items-baseline gap-2 text-sm tabular-nums">
                {formatBytes(destination.size)}
                <span className="truncate text-xs text-muted-foreground">
                    {share !== null ? `${Math.round(share * 100)} % of ${formatBytes(destination.alerts.storageLimit.bytes)}` : "No limit"}
                </span>
            </div>
            {share !== null && (
                <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className={cn("h-full rounded-full", share >= 0.9 ? "bg-warning" : "bg-foreground/80")} style={{ width: `${Math.min(share, 1) * 100}%` }} />
                </div>
            )}
        </div>
    );
}

/** How old the list of a destination is, the date in amber when it is behind. */
function ListCell({ destination }: { destination: ExplorerDestination }) {
    const behind = destination.listError !== null || destination.health.status === "OFFLINE" || !destination.listedAt;
    if (!destination.listedAt) return <span className="text-xs text-warning">Not compared yet</span>;
    if (behind) {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-warning">
                <ClockAlert className="size-3.5" aria-hidden="true" />
                <DateDisplay date={destination.listedAt} format="Pp" />
            </span>
        );
    }
    return <span className="text-xs whitespace-nowrap text-muted-foreground">Compared <RelativeTime date={destination.listedAt} /></span>;
}

function AlertsCell({ destination }: { destination: ExplorerDestination }) {
    const names = activeAlerts(destination);
    if (names.length === 0) return <span className="text-sm text-muted-foreground">-</span>;
    const missing = destination.alerts.missingBackup.active;
    return (
        <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs font-medium", missing ? "text-destructive" : "text-warning")}>
            <span className={cn("size-1.5 shrink-0 rounded-full", missing ? "bg-destructive" : "bg-warning")} aria-hidden="true" />
            <span className="truncate">{names.join(", ")}</span>
        </span>
    );
}

/** The columns of the list of destinations, with two only for the filters. */
export function destinationColumns({ jobs, renderActions }: ColumnsInput): ColumnDef<ExplorerDestination>[] {
    return [
        {
            id: "destination",
            accessorFn: (destination) => destination.name,
            header: "Destination",
            cell: ({ row }) => (
                <div className="flex min-w-0 items-center gap-3">
                    <DestinationTile destination={row.original} />
                    <div className="min-w-0">
                        <p className="truncate font-medium">{row.original.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{kindNames.get(row.original.adapterId) ?? row.original.adapterId}</p>
                    </div>
                </div>
            ),
        },
        { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <AnswerText destination={row.original} /> },
        { id: "stored", accessorFn: (destination) => destination.size, header: "Stored", cell: ({ row }) => <StoredCell destination={row.original} /> },
        {
            id: "growth",
            accessorFn: (destination) => destination.growth ?? 0,
            header: () => <div className="text-right">Last 7 days</div>,
            cell: ({ row }) => (
                <div className="text-right text-sm text-muted-foreground tabular-nums">
                    {row.original.growth === null ? "-" : row.original.growth === 0 ? "No change" : signedBytes(row.original.growth)}
                </div>
            ),
        },
        {
            id: "backups",
            accessorFn: (destination) => destination.count,
            header: () => <div className="text-right">Backups</div>,
            cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.count.toLocaleString()}</div>,
        },
        { id: "jobs", header: "Jobs", enableSorting: false, cell: ({ row }) => <JobsCell jobs={jobsOfDestination(row.original.id, jobs)} /> },
        { id: "list", header: "List", enableSorting: false, cell: ({ row }) => <ListCell destination={row.original} /> },
        { id: "alerts", header: "Alerts", enableSorting: false, cell: ({ row }) => <AlertsCell destination={row.original} /> },
        { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div> },
        // Only here for the filters.
        { id: "type", accessorFn: (destination) => destination.adapterId, filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)) },
        {
            id: "state",
            accessorFn: (destination) => statesOfDestination(destination),
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((state) => value.includes(state)),
        },
    ];
}
