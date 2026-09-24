"use client";

import { useMemo, useState } from "react";
import { flexRender, type ColumnDef, type ColumnFiltersState, type Row, type SortingState } from "@tanstack/react-table";
import { ChevronDown, ChevronRight, Info, Layers, Lock, LockOpen, Trash2 } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { requestBulk } from "@/lib/bulk-request";
import { cn, formatBytes } from "@/lib/utils";
import type { DestinationBackup, ExplorerDestination, ExplorerDestinationView, ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";
import { backupActions, type BackupActionHandlers } from "./backup-actions";
import { BackupContextMenu, BackupRowMenu } from "./backup-menus";
import { BackupTimeline, type TimelineLane } from "./backup-timeline";
import { BackupFlags, CopyChips, DestinationTile, IntegrityBadge, JobTile, SizeCell, TypeChip } from "./explorer-cells";
import { contentsOf, count, isIncremental, madeAt, snapshotBytes, startedBy, typeLabel } from "./explorer-format";
import { ExplorerStrip } from "./explorer-strip";
import type { BackupTarget } from "./use-backup-actions";

type FileFilter = "all" | "locked" | "failed" | "deleted";

/** How many backups a group of the grouped list shows before "Show all". */
const GROUP_PREVIEW = 3;

interface DestinationBackupsProps {
    view: ExplorerDestinationView;
    jobs: Map<string, ExplorerJob>;
    destinations: Map<string, ExplorerDestination>;
    display: "table" | "timeline";
    canDelete: boolean;
    handlersFor: (file: ExplorerFile, destinationId: string) => BackupActionHandlers;
    askDelete: (targets: BackupTarget[], title?: string) => void;
    onOpen: (backup: DestinationBackup) => void;
    onOpenJob: (key: string) => void;
    openPath: string | null;
    onChanged: () => void;
}

/** The backups of one destination, grouped by the job that made them. */
export function DestinationBackups({ view, jobs, destinations, display, canDelete, handlersFor, askDelete, onOpen, onOpenJob, openPath, onChanged }: DestinationBackupsProps) {
    const { destination, backups } = view;
    const [filter, setFilter] = useState<FileFilter>("all");
    const [grouped, setGrouped] = useState(true);
    const [sorting, setSorting] = useState<SortingState>([{ id: "backup", desc: true }]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const { formatDate } = useDateFormatter();

    const kindOf = (backup: DestinationBackup) => jobs.get(backup.jobKey)?.kind ?? "none";
    const visible = useMemo(() => {
        switch (filter) {
            case "locked":
                return backups.filter((backup) => backup.file.locked);
            case "failed":
                return backups.filter((backup) => backup.file.verification?.passed === false);
            case "deleted":
                return backups.filter((backup) => jobs.get(backup.jobKey)?.kind === "deleted");
            default:
                return backups;
        }
    }, [backups, filter, jobs]);

    const targetOf = (backup: DestinationBackup): BackupTarget => ({ file: backup.file, destinationId: destination.id });

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
    ], [destinations, destination.id, handlersFor, jobs, onOpen]);

    const bulkActions = useMemo<BulkAction<DestinationBackup>[]>(() => {
        if (!canDelete) return [];
        const run = (action: "delete" | "lock" | "unlock") => (rows: DestinationBackup[]) =>
            requestBulk(`/api/storage/${destination.id}/files/bulk`, { action, paths: rows.map((row) => row.file.path) });
        return [
            {
                id: "lock",
                labels: { verb: "lock", verbPast: "locked", noun: "backup" },
                icon: Lock,
                isAvailable: (rows) => rows.some((row) => !row.file.locked),
                itemName: (row) => row.file.name,
                ineligible: (row) => (row.file.locked ? "Already locked" : null),
                run: run("lock"),
            },
            {
                id: "unlock",
                labels: { verb: "unlock", verbPast: "unlocked", noun: "backup" },
                icon: LockOpen,
                isAvailable: (rows) => rows.some((row) => row.file.locked),
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
                    title: (rows) => `Delete ${rows.length} backup${rows.length === 1 ? "" : "s"}?`,
                    description: () => `This removes the archives and their metadata from ${destination.name}.`,
                    confirmLabel: "Delete",
                },
                run: run("delete"),
            },
        ];
    }, [canDelete, destination.id, destination.name]);

    const jobKeys = useMemo(() => [...new Set(backups.map((backup) => backup.jobKey))], [backups]);
    const locked = backups.filter((backup) => backup.file.locked).length;
    const failed = backups.filter((backup) => backup.file.verification?.passed === false).length;
    const checked = backups.filter((backup) => backup.file.verification).length;
    const deleted = backups.filter((backup) => kindOf(backup) === "deleted").length;
    const [sizeValue, sizeUnit] = formatBytes(destination.size, 1).split(" ");
    const newest = backups[0];
    const activeJobs = jobKeys.filter((key) => jobs.get(key)?.kind === "job").length;
    const deletedJobs = jobKeys.filter((key) => jobs.get(key)?.kind === "deleted").length;

    const lanes: TimelineLane[] = jobKeys.map((key) => {
        const job = jobs.get(key);
        const files = backups.filter((backup) => backup.jobKey === key);
        return {
            key,
            title: job?.name ?? "Without a job",
            note: `${count(files.length, "backup")} · ${formatBytes(files.reduce((sum, backup) => sum + backup.file.size, 0), 1)}`,
            icon: job ? <JobTile job={job} /> : <DestinationTile destination={destination} />,
            muted: job?.kind !== "job",
            endNote: job?.kind === "deleted" ? "The job was deleted, retention stopped with it" : undefined,
            points: files.map((backup) => ({
                id: backup.file.path,
                time: Date.parse(madeAt(backup.file)),
                chainId: backup.file.chain?.id,
                full: backup.file.chain?.type === "full",
                incremental: isIncremental(backup.file),
                state: backup.file.verification?.passed === false ? "failed" : backup.elsewhere.some((copy) => copy.state === "missing") ? "missing" : "ok",
                locked: backup.file.locked,
                label: `${formatDate(madeAt(backup.file), "Pp")} · ${typeLabel(backup.file)}`,
            })),
        };
    });
    const pickedJob = (columnFilters.find((entry) => entry.id === "job")?.value as string[] | undefined)?.[0] ?? null;

    const toolbarExtra = (
        <div className="flex flex-wrap items-center gap-2">
            <QuickFilter<FileFilter>
                aria-label="Show"
                value={filter}
                onChange={setFilter}
                options={[
                    { value: "all", label: "All", count: backups.length },
                    { value: "locked", label: "Locked", count: locked },
                    { value: "failed", label: "Check failed", count: failed, dot: "bg-destructive" },
                    ...(deleted > 0 ? [{ value: "deleted" as const, label: "Job deleted", count: deleted }] : []),
                ]}
            />
            <Button variant="outline" size="sm" className="h-7" aria-pressed={grouped} onClick={() => setGrouped((value) => !value)}>
                <Layers />
                {grouped ? "Grouped by job" : "Group by job"}
            </Button>
        </div>
    );

    return (
        <div className="space-y-4 md:space-y-6">
            <ExplorerStrip
                cells={[
                    { label: "Stored", value: sizeValue, unit: sizeUnit, extra: `in ${count(backups.length, "backup")}` },
                    {
                        label: "Backups",
                        value: backups.length.toLocaleString(),
                        extra: `from ${count(activeJobs, "job")}${deletedJobs > 0 ? ` and ${count(deletedJobs, "deleted job")}` : ""}`,
                    },
                    {
                        label: "Newest",
                        value: newest ? <RelativeTime date={madeAt(newest.file)} /> : "-",
                        extra: newest ? jobs.get(newest.jobKey)?.name ?? newest.file.name : undefined,
                    },
                    { label: "Locked", value: locked.toLocaleString(), extra: "kept past retention" },
                    {
                        label: "Integrity",
                        value: failed > 0 ? failed.toLocaleString() : checked.toLocaleString(),
                        unit: failed > 0 ? "failed" : `of ${backups.length.toLocaleString()} checked`,
                        tone: failed > 0 ? "destructive" : undefined,
                        extra: failed > 0 ? `${checked.toLocaleString()} of ${backups.length.toLocaleString()} checked` : undefined,
                    },
                ]}
            />

            {display === "timeline" && (
                <BackupTimeline
                    title="Timeline"
                    lanes={lanes}
                    selectedLane={pickedJob}
                    markedPointId={openPath}
                    onLaneClick={(key) => setColumnFilters(pickedJob === key ? [] : [{ id: "job", value: [key] }])}
                    onPointClick={(_lane, path) => {
                        const match = backups.find((backup) => backup.file.path === path);
                        if (match) onOpen(match);
                    }}
                />
            )}

            <DataTable
                // A path is only unique within one destination, so a selection must not carry over.
                key={destination.id}
                variant="card"
                columns={columns}
                data={visible}
                searchKey="backup"
                searchPlaceholder="Search backups"
                filterableColumns={[{ id: "job", title: "Job", options: jobKeys.map((key) => ({ label: jobs.get(key)?.name ?? "Without a job", value: key })) }]}
                toolbarExtra={toolbarExtra}
                sorting={sorting}
                onSortingChange={setSorting}
                columnFilters={columnFilters}
                onColumnFiltersChange={setColumnFilters}
                enableRowSelection={canDelete && !grouped}
                getRowId={(backup) => backup.file.path}
                bulkActions={bulkActions}
                onBulkActionComplete={onChanged}
                onRowClick={onOpen}
                view={grouped ? "split" : "table"}
                renderSplit={(rows) => (
                    <JobGroups
                        rows={rows}
                        jobs={jobs}
                        destination={destination}
                        openPath={openPath}
                        onOpen={onOpen}
                        onOpenJob={onOpenJob}
                        onDeleteAll={canDelete ? (files) => askDelete(files.map(targetOf), `Delete ${count(files.length, "backup")} of a deleted job?`) : undefined}
                    />
                )}
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
        </div>
    );
}

const GROUP_HEADERS: Record<string, string> = { backup: "Backup", job: "Job", inside: "What is inside", type: "Type", size: "Size", elsewhere: "Also at", integrity: "Integrity" };

interface JobGroupsProps {
    rows: Row<DestinationBackup>[];
    jobs: Map<string, ExplorerJob>;
    destination: ExplorerDestination;
    openPath: string | null;
    onOpen: (backup: DestinationBackup) => void;
    onOpenJob: (key: string) => void;
    onDeleteAll?: (files: DestinationBackup[]) => void;
}

/** The backups of a destination, a group per job, each showing its newest few until opened fully. */
function JobGroups({ rows, jobs, destination, openPath, onOpen, onOpenJob, onDeleteAll }: JobGroupsProps) {
    const groups = useMemo(() => {
        const byJob = new Map<string, Row<DestinationBackup>[]>();
        for (const row of rows) {
            const list = byJob.get(row.original.jobKey) ?? [];
            list.push(row);
            byJob.set(row.original.jobKey, list);
        }
        const order = { job: 0, deleted: 1, system: 2, none: 3 };
        return [...byJob.entries()]
            .map(([key, members]) => ({ key, job: jobs.get(key) ?? null, rows: members }))
            .sort((a, b) => order[a.job?.kind ?? "none"] - order[b.job?.kind ?? "none"] || (a.job?.name ?? "").localeCompare(b.job?.name ?? ""));
    }, [rows, jobs]);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    if (rows.length === 0) {
        return <div className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">No results.</div>;
    }

    const toggle = (setter: typeof setCollapsed, key: string) => setter((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
    });
    // The group names the job, and all of its backups hold the same, so both columns would repeat it.
    const hidden = new Set(["job", "inside"]);
    const columns = rows[0].getVisibleCells().map((cell) => cell.column.id).filter((id) => !hidden.has(id));

    return (
        <div className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        {columns.map((id) => (
                            <TableHead key={id} className={cn("px-3 text-xs text-muted-foreground first:pl-4 last:pr-4", id === "size" && "text-right", id === "actions" && "w-px")}>
                                {GROUP_HEADERS[id] ?? ""}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {groups.map((group) => {
                        const open = !collapsed.has(group.key);
                        const all = expanded.has(group.key);
                        const shown = open ? (all ? group.rows : group.rows.slice(0, GROUP_PREVIEW)) : [];
                        const size = group.rows.reduce((sum, row) => sum + row.original.file.size, 0);
                        const newest = group.rows.reduce((latest, row) => (Date.parse(madeAt(row.original.file)) > Date.parse(madeAt(latest.original.file)) ? row : latest));
                        const failedCount = group.rows.filter((row) => row.original.file.verification?.passed === false).length;
                        const Chevron = open ? ChevronDown : ChevronRight;
                        const job = group.job;
                        return [
                            <TableRow key={group.key} className="bg-muted/30 hover:bg-muted/50">
                                <TableCell colSpan={columns.length} className="px-4 py-2.5">
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => toggle(setCollapsed, group.key)}
                                            className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:underline"
                                            aria-expanded={open}
                                        >
                                            <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                            {job ? <JobTile job={job} /> : <DestinationTile destination={destination} />}
                                            <span className="min-w-0">
                                                <span className="flex items-center gap-2 text-sm font-semibold">
                                                    <span className={cn("truncate", job?.kind !== "job" && "text-muted-foreground")}>{job?.name ?? "Without a job"}</span>
                                                    {job?.kind === "deleted" && <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium text-foreground">Job deleted</span>}
                                                </span>
                                                <span className="block truncate text-xs font-normal text-muted-foreground">
                                                    {count(group.rows.length, "backup")} · newest <RelativeTime date={madeAt(newest.original.file)} />
                                                    {failedCount > 0 && <span className="text-destructive"> · {count(failedCount, "failed check")}</span>}
                                                </span>
                                            </span>
                                        </button>
                                        <span className="shrink-0 text-sm font-medium tabular-nums">{formatBytes(size, 1)}</span>
                                        {job?.kind === "job" && (
                                            <Button variant="ghost" size="sm" className="hidden h-7 shrink-0 sm:inline-flex" onClick={() => onOpenJob(group.key)}>
                                                By job
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>,
                            ...(open && job?.kind === "deleted"
                                ? [
                                    <TableRow key={`${group.key}-note`} className="hover:bg-transparent">
                                        <TableCell colSpan={columns.length} className="px-4 py-2">
                                            <div className="flex flex-wrap items-center gap-3 pl-7 text-sm">
                                                <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                                <span className="min-w-0 flex-1 text-muted-foreground">
                                                    Retention stopped with the job, so these backups stay until you delete them.
                                                </span>
                                                {onDeleteAll && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 text-destructive hover:text-destructive"
                                                        onClick={() => onDeleteAll(group.rows.map((row) => row.original).filter((backup) => !backup.file.locked))}
                                                    >
                                                        <Trash2 />
                                                        Delete {count(group.rows.filter((row) => !row.original.file.locked).length, "backup")}
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>,
                                ]
                                : []),
                            ...shown.map((row) => (
                                <TableRow
                                    key={row.id}
                                    onClick={() => onOpen(row.original)}
                                    data-state={row.original.file.path === openPath ? "selected" : undefined}
                                    className="group/row cursor-pointer [&>td]:px-3 [&>td]:py-2.5 [&>td:first-child]:pl-4 [&>td:last-child]:pr-4"
                                >
                                    {row.getVisibleCells().filter((cell) => !hidden.has(cell.column.id)).map((cell) => (
                                        <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                                    ))}
                                </TableRow>
                            )),
                            ...(open && group.rows.length > GROUP_PREVIEW
                                ? [
                                    <TableRow key={`${group.key}-more`} className="hover:bg-transparent">
                                        <TableCell colSpan={columns.length} className="px-4 py-1.5">
                                            <Button variant="ghost" size="sm" className="ml-5 h-7" onClick={() => toggle(setExpanded, group.key)}>
                                                {all ? <ChevronDown className="rotate-180" /> : <ChevronDown />}
                                                {all ? "Show fewer" : `Show all ${count(group.rows.length, "backup")}`}
                                            </Button>
                                        </TableCell>
                                    </TableRow>,
                                ]
                                : []),
                        ];
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
