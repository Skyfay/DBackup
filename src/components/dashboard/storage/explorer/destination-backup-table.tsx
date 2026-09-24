"use client";

import { useMemo, useState } from "react";
import type { ColumnDef, ColumnFiltersState, SortingState } from "@tanstack/react-table";
import { Lock, LockOpen, Trash2 } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import { requestBulk } from "@/lib/bulk-request";
import { cn } from "@/lib/utils";
import type { DestinationBackup, ExplorerDestination, ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";
import { backupActions, type BackupActionHandlers } from "./backup-actions";
import { BackupContextMenu, BackupRowMenu } from "./backup-menus";
import { BackupFlags, CopyChips, DestinationTile, IntegrityBadge, JobTile, SizeCell, TypeChip } from "./explorer-cells";
import { contentsOf, madeAt, snapshotBytes, startedBy, typeLabel } from "./explorer-format";

type FileFilter = "all" | "locked" | "failed" | "deleted";

interface DestinationBackupTableProps {
    destination: ExplorerDestination;
    rows: DestinationBackup[];
    jobs: Map<string, ExplorerJob>;
    destinations: Map<string, ExplorerDestination>;
    /** The list of every backup names the job of each, a folder of one job needs not. */
    showJob: boolean;
    canDelete: boolean;
    handlersFor: (file: ExplorerFile, destinationId: string) => BackupActionHandlers;
    onOpen: (backup: DestinationBackup) => void;
    onChanged: () => void;
    /** More controls beside the filters, like the switch between folders and every backup. */
    toolbarExtra?: React.ReactNode;
}

/** The job of each backup and what it holds, for the list of every backup of a destination. */
function jobColumns(jobs: Map<string, ExplorerJob>): ColumnDef<DestinationBackup>[] {
    return [
        {
            id: "job",
            accessorFn: (backup) => backup.jobKey,
            header: "Job",
            filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
            cell: ({ row }) => {
                const job = jobs.get(row.original.jobKey);
                return (
                    <span className="inline-flex min-w-0 items-center gap-2 text-sm">
                        <span className={cn("truncate", job?.kind !== "job" && "text-muted-foreground")}>{job?.name ?? "Without a job"}</span>
                        {job?.kind === "deleted" && <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium">Deleted</span>}
                    </span>
                );
            },
        },
        {
            id: "inside",
            header: "What is inside",
            cell: ({ row }) => <span className="block max-w-56 truncate text-sm">{contentsOf(row.original.file)}</span>,
        },
    ];
}

/** Backups of one destination as rows, with selection for the actions on many at once. */
export function DestinationBackupTable({
    destination,
    rows,
    jobs,
    destinations,
    showJob,
    canDelete,
    handlersFor,
    onOpen,
    onChanged,
    toolbarExtra,
}: DestinationBackupTableProps) {
    const [filter, setFilter] = useState<FileFilter>("all");
    const [sorting, setSorting] = useState<SortingState>([{ id: "backup", desc: true }]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

    const visible = useMemo(() => {
        switch (filter) {
            case "locked":
                return rows.filter((backup) => backup.file.locked);
            case "failed":
                return rows.filter((backup) => backup.file.verification?.passed === false);
            case "deleted":
                return rows.filter((backup) => jobs.get(backup.jobKey)?.kind === "deleted");
            default:
                return rows;
        }
    }, [rows, filter, jobs]);

    const columns = useMemo<ColumnDef<DestinationBackup>[]>(() => [
        {
            id: "backup",
            accessorFn: (backup) => backup.file.name,
            header: "Backup",
            sortingFn: (a, b) => Date.parse(madeAt(a.original.file)) - Date.parse(madeAt(b.original.file)),
            meta: { label: "Backup", pin: "start" },
            cell: ({ row }) => {
                const started = startedBy(row.original.file);
                return (
                    <button type="button" onClick={() => onOpen(row.original)} className="block max-w-80 min-w-0 text-left outline-none focus-visible:underline">
                        <span className="block truncate text-sm font-medium" title={row.original.file.name}>{row.original.file.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                            <RelativeTime date={madeAt(row.original.file)} />
                            {started && <> · {started.label}</>}
                        </span>
                    </button>
                );
            },
        },
        ...(showJob ? jobColumns(jobs) : []),
        { id: "type", header: "Type", cell: ({ row }) => <TypeChip file={row.original.file} /> },
        {
            id: "size",
            accessorFn: (backup) => snapshotBytes(backup.file),
            header: () => <div className="text-right">Size</div>,
            cell: ({ row }) => <SizeCell file={row.original.file} />,
        },
        {
            id: "elsewhere",
            header: "Also at",
            cell: ({ row }) => <CopyChips copies={row.original.elsewhere} destinations={destinations} />,
        },
        { id: "integrity", header: "Integrity", cell: ({ row }) => <IntegrityBadge verification={row.original.file.verification} /> },
        { id: "flags", header: "", cell: ({ row }) => <BackupFlags file={row.original.file} /> },
        {
            id: "actions",
            header: "",
            meta: { pin: "end" },
            cell: ({ row }) => (
                <div className="flex justify-end">
                    <BackupRowMenu name={row.original.file.name} groups={backupActions(row.original.file, handlersFor(row.original.file, destination.id))} />
                </div>
            ),
        },
    ], [showJob, jobs, destinations, destination.id, handlersFor, onOpen]);

    const bulkActions = useMemo<BulkAction<DestinationBackup>[]>(() => {
        if (!canDelete) return [];
        const run = (action: "delete" | "lock" | "unlock") => (selected: DestinationBackup[]) =>
            requestBulk(`/api/storage/${destination.id}/files/bulk`, { action, paths: selected.map((row) => row.file.path) });
        return [
            {
                id: "lock",
                labels: { verb: "lock", verbPast: "locked", noun: "backup" },
                icon: Lock,
                isAvailable: (selected) => selected.some((row) => !row.file.locked),
                itemName: (row) => row.file.name,
                ineligible: (row) => (row.file.locked ? "Already locked" : null),
                run: run("lock"),
            },
            {
                id: "unlock",
                labels: { verb: "unlock", verbPast: "unlocked", noun: "backup" },
                icon: LockOpen,
                isAvailable: (selected) => selected.some((row) => row.file.locked),
                itemName: (row) => row.file.name,
                ineligible: (row) => (row.file.locked ? null : "Not locked"),
                run: run("unlock"),
            },
            {
                id: "delete",
                labels: { verb: "delete", verbPast: "deleted", noun: "backup" },
                icon: Trash2,
                variant: "destructive",
                itemName: (row) => row.file.name,
                // A locked backup was protected on purpose. The server refuses it as well.
                ineligible: (row) => (row.file.locked ? "Locked, unlock it first" : null),
                confirm: {
                    title: (selected) => `Delete ${selected.length} backup${selected.length === 1 ? "" : "s"}?`,
                    description: () => `This removes the archives and their metadata from ${destination.name}.`,
                    confirmLabel: "Delete",
                },
                run: run("delete"),
            },
        ];
    }, [canDelete, destination.id, destination.name]);

    const jobKeys = useMemo(() => [...new Set(rows.map((backup) => backup.jobKey))], [rows]);
    const deleted = showJob ? rows.filter((backup) => jobs.get(backup.jobKey)?.kind === "deleted").length : 0;

    return (
        <DataTable
            // A path is only unique within one destination, so a selection must not carry over.
            key={destination.id}
            variant="card"
            columns={columns}
            data={visible}
            searchKey="backup"
            searchPlaceholder="Search backups"
            filterableColumns={showJob ? [{ id: "job", title: "Job", options: jobKeys.map((key) => ({ label: jobs.get(key)?.name ?? "Without a job", value: key })) }] : undefined}
            toolbarExtra={
                <div className="flex flex-wrap items-center gap-2">
                    <QuickFilter<FileFilter>
                        aria-label="Show"
                        value={filter}
                        onChange={setFilter}
                        options={[
                            { value: "all", label: "All", count: rows.length },
                            { value: "locked", label: "Locked", count: rows.filter((backup) => backup.file.locked).length },
                            { value: "failed", label: "Check failed", count: rows.filter((backup) => backup.file.verification?.passed === false).length, dot: "bg-destructive" },
                            ...(deleted > 0 ? [{ value: "deleted" as const, label: "Job deleted", count: deleted }] : []),
                        ]}
                    />
                    {toolbarExtra}
                </div>
            }
            sorting={sorting}
            onSortingChange={setSorting}
            columnFilters={columnFilters}
            onColumnFiltersChange={setColumnFilters}
            enableRowSelection={canDelete}
            getRowId={(backup) => backup.file.path}
            bulkActions={bulkActions}
            onBulkActionComplete={onChanged}
            onRowClick={onOpen}
            renderRowMenu={(backup, bulk) => {
                const job = jobs.get(backup.jobKey);
                return (
                    <BackupContextMenu
                        tile={job ? <JobTile job={job} /> : <DestinationTile destination={destination} />}
                        title={backup.file.name}
                        note={`${job?.name ?? "Without a job"} · ${typeLabel(backup.file)}`}
                        groups={backupActions(backup.file, handlersFor(backup.file, destination.id))}
                        bulk={bulk}
                    />
                );
            }}
        />
    );
}
