"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { ArrowRight, Trash2 } from "lucide-react";
import { kindNames } from "@/components/adapter/connection-columns";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { describeRetention } from "@/components/templates/retention-words";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableFilterableColumn } from "@/components/ui/data-table";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerDestination } from "@/services/storage/explorer-types";
import { statesOfJob, typeOfJob, type DestinationJob, type DestinationJobState } from "./destination-model";
import { CopyChips, JobIcon, JobTile } from "./explorer-cells";
import { count } from "./explorer-format";

const STATES: { value: DestinationJobState; label: string }[] = [
    { value: "deleted", label: "Job deleted" },
    { value: "missing", label: "A copy is missing here" },
    { value: "failed", label: "A check failed" },
    { value: "locked", label: "Holds locked backups" },
];

const TYPE_NAMES: Record<string, string> = { folders: "Folders", system: "DBackup config", none: "Not from a job" };

interface DestinationJobsProps {
    destination: ExplorerDestination;
    entries: DestinationJob[];
    destinations: Map<string, ExplorerDestination>;
    canDelete: boolean;
    /** Deletes the backups of a deleted job at this destination, after a confirmation. */
    onDelete: (entry: DestinationJob) => void;
}

/**
 * Every job with backups at a destination: how many and how big, the newest, where else they lie
 * and what the retention there keeps. A job that exists lists its backups in the Backups tab, the
 * backups of a deleted job can be deleted here.
 */
export function DestinationJobs({ destination, entries, destinations, canDelete, onDelete }: DestinationJobsProps) {
    const [sorting, setSorting] = useState<SortingState>([]);

    const columns = useMemo<ColumnDef<DestinationJob>[]>(() => [
        {
            id: "job",
            accessorFn: (entry) => entry.job.name,
            header: "Job",
            cell: ({ row }) => {
                const { job } = row.original;
                const deleted = job.kind === "deleted";
                return (
                    <div className="flex min-w-0 items-center gap-3">
                        <JobTile job={job} size="sm" />
                        <span className={cn("truncate font-medium", deleted && "text-muted-foreground")}>{job.name}</span>
                        {deleted && <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Job deleted</span>}
                    </div>
                );
            },
        },
        {
            id: "backups",
            accessorFn: (entry) => entry.backups,
            header: () => <div className="text-right">Backups</div>,
            cell: ({ row }) => <div className="text-right font-medium tabular-nums">{row.original.backups}</div>,
        },
        {
            id: "size",
            accessorFn: (entry) => entry.size,
            header: () => <div className="text-right">Stored here</div>,
            cell: ({ row }) => <div className="text-right tabular-nums">{formatBytes(row.original.size)}</div>,
        },
        {
            id: "newest",
            accessorFn: (entry) => entry.newest ?? "",
            header: "Newest",
            cell: ({ row }) => (row.original.newest ? <RelativeTime date={row.original.newest} className="text-sm" /> : <span className="text-muted-foreground">-</span>),
        },
        {
            id: "alsoAt",
            header: "Also at",
            enableSorting: false,
            cell: ({ row }) => (
                <CopyChips copies={row.original.alsoAt.map((destinationId) => ({ destinationId, state: "stored" as const }))} destinations={destinations} empty="Only here" />
            ),
        },
        {
            id: "retention",
            header: "Retention",
            enableSorting: false,
            cell: ({ row }) => {
                const { job } = row.original;
                const policy = job.retention[destination.id];
                const text = job.kind === "deleted" ? "Kept until you delete them" : policy ? describeRetention(policy) : "Keeps everything";
                return <span className="text-sm text-muted-foreground">{text}</span>;
            },
        },
        {
            id: "actions",
            header: "",
            enableSorting: false,
            cell: ({ row }) => {
                const entry = row.original;
                if (entry.job.kind === "deleted") {
                    return canDelete && entry.backups > 0 ? (
                        <div className="flex justify-end">
                            <Button variant="ghost-destructive" size="sm" onClick={() => onDelete(entry)}>
                                <Trash2 />
                                Delete {entry.backups}
                            </Button>
                        </div>
                    ) : null;
                }
                return (
                    <div className="flex justify-end">
                        <Button variant="ghost" size="sm" asChild>
                            <Link href={`/dashboard/storage?job=${encodeURIComponent(entry.job.key)}&at=${encodeURIComponent(destination.id)}`}>
                                Show backups
                                <ArrowRight />
                            </Link>
                        </Button>
                    </div>
                );
            },
        },
        // Only here for the filters, the job shows its kind in its tile and its states in its row.
        { id: "type", accessorFn: (entry) => typeOfJob(entry.job), filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)) },
        {
            id: "state",
            accessorFn: (entry) => statesOfJob(entry),
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((state) => value.includes(state)),
        },
    ], [destination, destinations, canDelete, onDelete]);

    const filterableColumns = useMemo<DataTableFilterableColumn<DestinationJob>[]>(() => {
        const types = new Map<string, DestinationJob[]>();
        for (const entry of entries) {
            const type = typeOfJob(entry.job);
            types.set(type, [...(types.get(type) ?? []), entry]);
        }
        const note = "The numbers count the jobs";
        return [
            {
                id: "type",
                title: "Type",
                note,
                options: [...types].map(([type, list]) => ({
                    value: type,
                    label: TYPE_NAMES[type] ?? kindNames.get(type) ?? type,
                    lead: <JobIcon job={list[0].job} className="size-4 shrink-0" />,
                    count: list.length,
                })),
            },
            {
                id: "state",
                title: "State",
                note,
                options: STATES.map((state) => ({ ...state, count: entries.filter((entry) => statesOfJob(entry).includes(state.value)).length })),
            },
        ];
    }, [entries]);

    return (
        <DataTable
            variant="card"
            columns={columns}
            data={entries}
            searchKey="job"
            searchPlaceholder="Search jobs"
            filterableColumns={filterableColumns}
            initialColumnVisibility={{ type: false, state: false }}
            sorting={sorting}
            onSortingChange={setSorting}
            toolbarNote={
                <p className="px-4 pb-3 text-xs text-muted-foreground">
                    {count(entries.length, "job")} with backups at {destination.name}. Show backups lists them in the Backups tab.
                </p>
            }
            getRowId={(entry) => entry.job.key}
            initialPageSize={20}
        />
    );
}
