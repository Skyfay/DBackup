"use client";

import { useMemo, useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { ArrowUpRight, ChevronLeft, ChevronRight, Info, Trash2 } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerDestination } from "@/services/storage/explorer-types";
import type { BackupFolder } from "./destination-folders";
import { CopyChips, DestinationTile, JobTile } from "./explorer-cells";
import { count } from "./explorer-format";

export function FolderTile({ folder, destination }: { folder: BackupFolder; destination: ExplorerDestination }) {
    return folder.job ? <JobTile job={folder.job} /> : <DestinationTile destination={destination} />;
}

function DeletedChip() {
    return <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium text-foreground">Job deleted</span>;
}

type FolderFilter = "all" | "failed" | "deleted";

interface FolderListProps {
    folders: BackupFolder[];
    destination: ExplorerDestination;
    destinations: Map<string, ExplorerDestination>;
    onFolder: (key: string) => void;
    toolbarExtra: React.ReactNode;
}

/** One row per job, like the folders the jobs write into on the storage. A click opens one. */
export function FolderList({ folders, destination, destinations, onFolder, toolbarExtra }: FolderListProps) {
    const [filter, setFilter] = useState<FolderFilter>("all");
    const [sorting, setSorting] = useState<SortingState>([]);
    const failed = folders.filter((folder) => folder.failed > 0).length;
    const deleted = folders.filter((folder) => folder.kind === "deleted").length;
    const visible = filter === "failed"
        ? folders.filter((folder) => folder.failed > 0)
        : filter === "deleted"
            ? folders.filter((folder) => folder.kind === "deleted")
            : folders;

    const columns = useMemo<ColumnDef<BackupFolder>[]>(() => [
        {
            id: "name",
            accessorFn: (folder) => folder.name,
            header: "Job",
            meta: { label: "Job", pin: "start" },
            cell: ({ row }) => (
                <button type="button" onClick={() => onFolder(row.original.key)} className="flex min-w-0 items-center gap-3 text-left outline-none focus-visible:underline">
                    <FolderTile folder={row.original} destination={destination} />
                    <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-medium">
                            <span className={cn("truncate", row.original.kind !== "job" && "text-muted-foreground")}>{row.original.name}</span>
                            {row.original.kind === "deleted" && <DeletedChip />}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                            {count(row.original.backups.length, "backup")} · newest <RelativeTime date={row.original.newest} />
                        </span>
                    </span>
                </button>
            ),
        },
        {
            id: "size",
            accessorFn: (folder) => folder.size,
            header: () => <div className="text-right">Size</div>,
            cell: ({ row }) => <div className="text-right text-sm font-medium tabular-nums">{formatBytes(row.original.size, 1)}</div>,
        },
        {
            id: "elsewhere",
            header: "Also at",
            cell: ({ row }) => (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <CopyChips copies={row.original.elsewhere} destinations={destinations} />
                    {row.original.missing > 0 && <span className="text-xs text-warning">{count(row.original.missing, "copy", "copies")} missing</span>}
                </span>
            ),
        },
        {
            id: "integrity",
            header: "Integrity",
            cell: ({ row }) => {
                const { backups, failed: failedChecks } = row.original;
                if (failedChecks > 0) return <span className="text-xs font-medium whitespace-nowrap text-destructive">{count(failedChecks, "check")} failed</span>;
                const verified = backups.filter((backup) => backup.file.verification?.passed).length;
                return <span className="text-xs whitespace-nowrap text-muted-foreground">{verified} of {backups.length} verified</span>;
            },
        },
        {
            id: "open",
            header: "",
            meta: { pin: "end" },
            cell: () => <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden="true" />,
        },
    ], [destination, destinations, onFolder]);

    return (
        <DataTable
            key={destination.id}
            variant="card"
            columns={columns}
            data={visible}
            searchKey="name"
            searchPlaceholder="Search jobs"
            sorting={sorting}
            onSortingChange={setSorting}
            onRowClick={(folder) => onFolder(folder.key)}
            toolbarExtra={
                <div className="flex flex-wrap items-center gap-2">
                    <QuickFilter<FolderFilter>
                        aria-label="Show"
                        value={filter}
                        onChange={setFilter}
                        options={[
                            { value: "all", label: "All", count: folders.length },
                            { value: "failed", label: "Check failed", count: failed, dot: "bg-destructive" },
                            ...(deleted > 0 ? [{ value: "deleted" as const, label: "Job deleted", count: deleted }] : []),
                        ]}
                    />
                    {toolbarExtra}
                </div>
            }
        />
    );
}

interface FolderHeadProps {
    folder: BackupFolder;
    destination: ExplorerDestination;
    onBack: () => void;
    onOpenJob: (key: string) => void;
    onDeleteAll?: () => void;
}

/** The top of an open folder: the way back, where it is, and for a deleted job what is left to do. */
export function FolderHead({ folder, destination, onBack, onOpenJob, onDeleteAll }: FolderHeadProps) {
    const deletable = folder.backups.filter((backup) => !backup.file.locked).length;
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" onClick={onBack}>
                    <ChevronLeft />
                    All folders
                </Button>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                    <FolderTile folder={folder} destination={destination} />
                    <div className="min-w-0">
                        <p className="flex min-w-0 items-center gap-1.5 text-sm">
                            <span className="truncate text-muted-foreground">{destination.name}</span>
                            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="truncate font-semibold">{folder.name}</span>
                            {folder.kind === "deleted" && <DeletedChip />}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                            {count(folder.backups.length, "backup")} · {formatBytes(folder.size, 1)} · newest <RelativeTime date={folder.newest} />
                        </p>
                    </div>
                </div>
                <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => onOpenJob(folder.key)}>
                    <ArrowUpRight />
                    Open in Jobs
                </Button>
            </div>
            {folder.kind === "deleted" && (
                <div className="relative overflow-hidden rounded-xl border bg-card p-4 pl-5 shadow-sm md:pl-6">
                    <span className="absolute inset-y-0 left-0 w-1 bg-muted-foreground/40" aria-hidden="true" />
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                <Info className="size-5" aria-hidden="true" />
                            </div>
                            <div className="min-w-0 flex-1 space-y-0.5">
                                <p className="font-semibold leading-snug">The job was deleted</p>
                                <p className="text-sm text-muted-foreground">Retention stopped with the job, so these backups stay until you delete them.</p>
                            </div>
                        </div>
                        {onDeleteAll && deletable > 0 && (
                            <Button variant="outline" size="sm" className="w-full text-destructive hover:text-destructive sm:w-auto" onClick={onDeleteAll}>
                                <Trash2 />
                                Delete {count(deletable, "backup")}
                            </Button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
