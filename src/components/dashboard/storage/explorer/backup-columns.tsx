"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import type { BackupRun, ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import { copiesIn, isLocked, verificationOf } from "./backup-filters";
import { BackupFlags, CopyChips, IntegrityBadge, JobTile, MadeAt, SizeCell, StartedBy, TypeChip } from "./explorer-cells";
import { contentsOf, snapshotBytes } from "./explorer-format";

interface BackupColumnOptions {
    jobs: Map<string, ExplorerJob>;
    destinations: Map<string, ExplorerDestination>;
    /** The destinations of the filter, which the copies, the check and the lock are counted at. */
    at: string[];
    onOpen: (run: BackupRun) => void;
    renderActions: (run: BackupRun) => React.ReactNode;
}

/** The job of a backup, dimmed with a chip when the job was deleted. */
function JobCell({ job }: { job: ExplorerJob | undefined }) {
    return (
        <span className="inline-flex min-w-0 items-center gap-2.5 text-sm">
            {job && <JobTile job={job} size="sm" />}
            <span className={cn("truncate font-medium", job?.kind !== "job" && "text-muted-foreground")}>{job?.name ?? "Without a job"}</span>
            {job?.kind === "deleted" && <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium">Job deleted</span>}
        </span>
    );
}

/** The columns of the list of every backup. The Columns menu decides which of them show. */
export function backupColumns({ jobs, destinations, at, onOpen, renderActions }: BackupColumnOptions): ColumnDef<BackupRun>[] {
    return [
        {
            id: "backup",
            // The name is what the search looks for, the date is what the column sorts by.
            accessorFn: (run) => run.file.name,
            header: "Backup",
            sortingFn: (a, b) => Date.parse(a.original.createdAt) - Date.parse(b.original.createdAt),
            meta: { label: "Backup", pin: "start" },
            cell: ({ row }) => (
                <button type="button" onClick={() => onOpen(row.original)} className="min-w-0 text-left outline-none focus-visible:underline">
                    <MadeAt file={row.original.file} />
                </button>
            ),
        },
        {
            id: "job",
            accessorFn: (run) => jobs.get(run.jobKey)?.name ?? "",
            header: "Job",
            meta: { label: "Job" },
            cell: ({ row }) => <JobCell job={jobs.get(row.original.jobKey)} />,
        },
        { id: "type", header: "Type", meta: { label: "Type" }, cell: ({ row }) => <TypeChip file={row.original.file} /> },
        { id: "startedBy", header: "Started by", meta: { label: "Started by" }, cell: ({ row }) => <StartedBy file={row.original.file} /> },
        {
            id: "inside",
            header: "What is inside",
            meta: { label: "What is inside", defaultHidden: true },
            cell: ({ row }) => <span className="block max-w-56 truncate text-sm">{contentsOf(row.original.file)}</span>,
        },
        {
            id: "size",
            accessorFn: (run) => snapshotBytes(run.file),
            header: () => <div className="text-right">Size</div>,
            meta: { label: "Size" },
            cell: ({ row }) => <SizeCell file={row.original.file} />,
        },
        {
            id: "at",
            header: "Stored at",
            meta: { label: "Stored at" },
            cell: ({ row }) => <CopyChips copies={copiesIn(row.original, at)} destinations={destinations} />,
        },
        {
            id: "integrity",
            header: "Integrity",
            meta: { label: "Integrity" },
            cell: ({ row }) => <IntegrityBadge verification={verificationOf(row.original, at)} />,
        },
        {
            id: "flags",
            header: "",
            meta: { label: "Locked and encrypted" },
            cell: ({ row }) => <BackupFlags file={{ locked: isLocked(row.original, at), isEncrypted: row.original.file.isEncrypted }} />,
        },
        {
            id: "actions",
            header: "",
            meta: { pin: "end", label: "Actions" },
            cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
        },
    ];
}
