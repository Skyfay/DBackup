"use client";

import { useMemo, useState } from "react";
import { flexRender, type ColumnDef, type Row, type SortingState } from "@tanstack/react-table";
import { ChevronDown, ChevronRight, Layers, Lock, LockOpen, Trash2 } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateDisplay } from "@/components/utils/date-display";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import type { BulkResult } from "@/lib/core/bulk";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerDestination, ExplorerFile, ExplorerJobView } from "@/services/storage/explorer-types";
import { backupActions, type BackupActionHandlers } from "./backup-actions";
import { BackupContextMenu, BackupRowMenu } from "./backup-menus";
import { BackupTimeline, type TimelineLane } from "./backup-timeline";
import { BackupFlags, CopyChips, IntegrityBadge, JobTile, MadeAt, SizeCell, StartedBy, TypeChip } from "./explorer-cells";
import { count, isIncremental, madeAt, snapshotBytes, typeLabel } from "./explorer-format";
import { ExplorerStrip } from "./explorer-strip";
import { bulkAcross, type BackupTarget } from "./use-backup-actions";

export type JobRun = ExplorerJobView["runs"][number];
type RunFilter = "all" | "locked" | "missing" | "failed";

const failedCheck = (run: JobRun) => run.copies.some((copy) => copy.file?.verification?.passed === false);
const hasMissing = (run: JobRun) => run.copies.some((copy) => copy.state === "missing");
const isLocked = (run: JobRun) => run.copies.some((copy) => copy.file?.locked);
const storedCopies = (run: JobRun): BackupTarget[] =>
    run.copies.flatMap((copy) => (copy.state === "stored" && copy.file ? [{ file: copy.file, destinationId: copy.destinationId }] : []));

/** The copy the list shows and acts on: the first one in the upload order of the job. */
export function primaryCopy(run: JobRun): BackupTarget {
    return storedCopies(run)[0] ?? { file: run.file, destinationId: run.copies[0]?.destinationId ?? "" };
}

/** The verification to show for a run: a failed copy wins, then the primary one. */
function verificationOf(run: JobRun): ExplorerFile["verification"] {
    const failed = run.copies.find((copy) => copy.file?.verification?.passed === false);
    return failed?.file?.verification ?? run.file.verification;
}

/** Turns the results per copy into results per run, which is what the list selected. */
function perRun(result: BulkResult, runs: JobRun[]): BulkResult {
    const failedIds = new Map(result.failed.map((failure) => [failure.id, failure]));
    const merged: BulkResult = { succeeded: [], failed: [] };
    for (const run of runs) {
        const ids = storedCopies(run).map((target) => `${target.destinationId}:${target.file.path}`);
        const failure = ids.map((id) => failedIds.get(id)).find((entry) => entry !== undefined);
        if (failure) merged.failed.push({ id: run.path, name: run.file.name, error: failure.error });
        else merged.succeeded.push(run.path);
    }
    return merged;
}

interface JobBackupsProps {
    view: ExplorerJobView;
    destinations: Map<string, ExplorerDestination>;
    display: "table" | "timeline";
    canDelete: boolean;
    handlersFor: (file: ExplorerFile, destinationId: string) => BackupActionHandlers;
    askDelete: (targets: BackupTarget[], title?: string) => void;
    onOpen: (run: JobRun) => void;
    /** The run whose details are open. */
    openPath: string | null;
    onChanged: () => void;
}

/** The backups of one job: a run per row, with where each copy of it lies. */
export function JobBackups({ view, destinations, display, canDelete, handlersFor, askDelete, onOpen, openPath, onChanged }: JobBackupsProps) {
    const { job, runs } = view;
    const [filter, setFilter] = useState<RunFilter>("all");
    const chained = runs.some((run) => run.file.chain);
    const [grouped, setGrouped] = useState(true);
    const [sorting, setSorting] = useState<SortingState>([{ id: "run", desc: true }]);
    // The timeline shows the same backups as the list, so it leaves the list out until its lane is clicked.
    const [listOpen, setListOpen] = useState(false);
    const { formatDate } = useDateFormatter();
    const byChain = chained && grouped;
    const showList = display === "table" || listOpen;

    const visible = useMemo(() => {
        switch (filter) {
            case "locked":
                return runs.filter(isLocked);
            case "missing":
                return runs.filter(hasMissing);
            case "failed":
                return runs.filter(failedCheck);
            default:
                return runs;
        }
    }, [runs, filter]);

    const deleteRun = (run: JobRun) => {
        const targets = storedCopies(run);
        askDelete(targets, targets.length > 1 ? `Delete this backup at ${targets.length} destinations?` : "Delete this backup?");
    };

    const columns = useMemo<ColumnDef<JobRun>[]>(() => [
        {
            id: "run",
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
        { id: "startedBy", header: "Started by", cell: ({ row }) => <StartedBy file={row.original.file} /> },
        ...(chained ? [{ id: "type", header: "Type", cell: ({ row }: { row: Row<JobRun> }) => <TypeChip file={row.original.file} /> }] : []),
        {
            id: "size",
            accessorFn: (run) => snapshotBytes(run.file),
            header: () => <div className="text-right">Size</div>,
            cell: ({ row }) => <SizeCell file={row.original.file} />,
        },
        {
            id: "storedAt",
            header: "Stored at",
            cell: ({ row }) => <CopyChips copies={row.original.copies} destinations={destinations} />,
        },
        { id: "integrity", header: "Integrity", cell: ({ row }) => <IntegrityBadge verification={verificationOf(row.original)} /> },
        {
            id: "flags",
            header: "",
            cell: ({ row }) => <BackupFlags file={{ locked: isLocked(row.original), isEncrypted: row.original.file.isEncrypted }} />,
        },
        {
            id: "actions",
            header: "",
            meta: { pin: "end" },
            cell: ({ row }) => {
                const target = primaryCopy(row.original);
                const handlers = handlersFor(target.file, target.destinationId);
                return (
                    <div className="flex justify-end">
                        <BackupRowMenu name={row.original.file.name} groups={backupActions(target.file, { ...handlers, onDelete: handlers.onDelete ? () => deleteRun(row.original) : undefined })} />
                    </div>
                );
            },
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [chained, destinations, handlersFor, onOpen]);

    const bulkActions = useMemo<BulkAction<JobRun>[]>(() => {
        if (!canDelete) return [];
        const run = (action: "delete" | "lock" | "unlock") => async (rows: JobRun[]) => perRun(await bulkAcross(action, rows.flatMap(storedCopies)), rows);
        return [
            {
                id: "lock",
                labels: { verb: "lock", verbPast: "locked", noun: "backup" },
                icon: Lock,
                isAvailable: (rows) => rows.some((row) => !isLocked(row)),
                itemName: (row) => row.file.name,
                ineligible: (row) => (isLocked(row) ? "Already locked" : null),
                run: run("lock"),
            },
            {
                id: "unlock",
                labels: { verb: "unlock", verbPast: "unlocked", noun: "backup" },
                icon: LockOpen,
                isAvailable: (rows) => rows.some(isLocked),
                itemName: (row) => row.file.name,
                ineligible: (row) => (isLocked(row) ? null : "Not locked"),
                run: run("unlock"),
            },
            {
                id: "delete",
                labels: { verb: "delete", verbPast: "deleted", noun: "backup" },
                icon: Trash2,
                variant: "destructive",
                itemName: (row) => row.file.name,
                itemDetail: (row) => count(storedCopies(row).length, "copy", "copies"),
                // A locked backup was protected on purpose. The server refuses it as well.
                ineligible: (row) => (isLocked(row) ? "Locked, unlock it first" : null),
                confirm: {
                    title: (rows) => `Delete ${rows.length} backup${rows.length === 1 ? "" : "s"}?`,
                    description: () => "This removes every copy of them, at every destination of the job.",
                    confirmLabel: "Delete",
                },
                run: run("delete"),
            },
        ];
    }, [canDelete]);

    const verified = runs.filter((run) => run.file.verification?.passed).length;
    const failed = runs.filter(failedCheck).length;
    const copies = runs.reduce((sum, run) => sum + run.copies.length, 0);
    const missing = runs.reduce((sum, run) => sum + run.copies.filter((copy) => copy.state === "missing").length, 0);
    const [sizeValue, sizeUnit] = formatBytes(job.size, 1).split(" ");
    const newest = runs[0];

    const lane: TimelineLane = {
        key: job.key,
        title: job.name,
        note: `${count(runs.length, "backup")} · ${formatBytes(job.size, 1)}`,
        icon: <JobTile job={job} />,
        muted: job.kind === "deleted",
        endNote: job.kind === "deleted" ? "The job was deleted, so no new backups came" : undefined,
        points: runs.map((entry) => ({
            id: entry.path,
            time: Date.parse(entry.createdAt),
            chainId: entry.file.chain?.id,
            full: entry.file.chain?.type === "full",
            incremental: isIncremental(entry.file),
            state: failedCheck(entry) ? "failed" : hasMissing(entry) ? "missing" : "ok",
            locked: isLocked(entry),
            label: `${formatDate(entry.createdAt, "Pp")} · ${typeLabel(entry.file)}`,
        })),
    };

    const toolbarExtra = (
        <div className="flex flex-wrap items-center gap-2">
            <QuickFilter<RunFilter>
                aria-label="Show"
                value={filter}
                onChange={setFilter}
                options={[
                    { value: "all", label: "All", count: runs.length },
                    { value: "locked", label: "Locked", count: runs.filter(isLocked).length },
                    { value: "missing", label: "Copy missing", count: runs.filter(hasMissing).length, dot: "bg-warning" },
                    { value: "failed", label: "Check failed", count: failed, dot: "bg-destructive" },
                ]}
            />
            {chained && (
                <Button variant="outline" size="sm" className="h-7" aria-pressed={grouped} onClick={() => setGrouped((value) => !value)}>
                    <Layers />
                    {grouped ? "Grouped by chain" : "Group by chain"}
                </Button>
            )}
        </div>
    );

    return (
        <div className="space-y-4 md:space-y-6">
            <ExplorerStrip
                cells={[
                    {
                        label: "Backups",
                        value: runs.length.toLocaleString(),
                        extra: runs.length > 0 ? <>the oldest from <DateDisplay date={runs[runs.length - 1].createdAt} format="P" /></> : "none yet",
                    },
                    { label: "Stored", value: sizeValue, unit: sizeUnit, extra: `at ${count(job.destinationIds.length, "destination")}` },
                    {
                        label: "Newest",
                        value: newest ? <RelativeTime date={newest.createdAt} /> : "-",
                        extra: newest ? typeLabel(newest.file) : undefined,
                    },
                    {
                        label: "Copies",
                        value: (copies - missing).toLocaleString(),
                        unit: `of ${copies.toLocaleString()}`,
                        tone: missing > 0 ? "warning" : undefined,
                        extra: missing > 0 ? `${count(missing, "copy", "copies")} missing` : "none missing",
                    },
                    {
                        label: "Integrity",
                        value: failed > 0 ? failed.toLocaleString() : verified.toLocaleString(),
                        unit: failed > 0 ? "failed" : `of ${runs.length.toLocaleString()} verified`,
                        tone: failed > 0 ? "destructive" : undefined,
                        extra: failed > 0 ? `${verified.toLocaleString()} verified` : undefined,
                    },
                ]}
            />

            {display === "timeline" && (
                <BackupTimeline
                    title="Timeline"
                    hint={listOpen ? "click the job to hide its backups" : "click the job to list its backups, a point to open one"}
                    lanes={[lane]}
                    selectedLane={listOpen ? job.key : null}
                    onLaneClick={() => setListOpen((open) => !open)}
                    markedPointId={openPath}
                    onPointClick={(_lane, path) => {
                        const match = runs.find((entry) => entry.path === path);
                        if (match) onOpen(match);
                    }}
                />
            )}

            {showList && (
                <DataTable
                    // The rows are runs of this job, so a selection must not carry over into another job.
                    key={job.key}
                    variant="card"
                    columns={columns}
                    data={visible}
                    searchKey="run"
                    searchPlaceholder="Search backups"
                    toolbarExtra={toolbarExtra}
                    sorting={sorting}
                    onSortingChange={setSorting}
                    enableRowSelection={canDelete && !byChain}
                    getRowId={(run) => run.path}
                    bulkActions={bulkActions}
                    onBulkActionComplete={onChanged}
                    onRowClick={onOpen}
                    view={byChain ? "split" : "table"}
                    renderSplit={(rows) => <ChainGroups rows={rows} openPath={openPath} onOpen={onOpen} />}
                    renderRowMenu={(run, bulk) => {
                        const target = primaryCopy(run);
                        const handlers = handlersFor(target.file, target.destinationId);
                        return (
                            <BackupContextMenu
                                tile={<JobTile job={job} />}
                                title={run.file.name}
                                note={`${job.name} · ${typeLabel(run.file)}`}
                                groups={backupActions(target.file, { ...handlers, onDelete: handlers.onDelete ? () => deleteRun(run) : undefined })}
                                bulk={bulk}
                            />
                        );
                    }}
                />
            )}
        </div>
    );
}

const CHAIN_HEADERS: Record<string, string> = { run: "Backup", startedBy: "Started by", type: "Type", size: "Size", storedAt: "Stored at", integrity: "Integrity" };

/** The runs of an incremental job, a group per chain with the newest chain open. */
function ChainGroups({ rows, openPath, onOpen }: { rows: Row<JobRun>[]; openPath: string | null; onOpen: (run: JobRun) => void }) {
    const groups = useMemo(() => {
        const byChain = new Map<string, Row<JobRun>[]>();
        for (const row of rows) {
            const key = row.original.file.chain?.id ?? "none";
            const list = byChain.get(key) ?? [];
            list.push(row);
            byChain.set(key, list);
        }
        return [...byChain.entries()]
            .map(([key, members]) => {
                const sorted = [...members].sort((a, b) => Date.parse(b.original.createdAt) - Date.parse(a.original.createdAt));
                const full = sorted.find((row) => row.original.file.chain?.type === "full") ?? sorted[sorted.length - 1];
                return { key, rows: sorted, full: full.original, newest: sorted[0].original };
            })
            .sort((a, b) => Date.parse(b.newest.createdAt) - Date.parse(a.newest.createdAt));
    }, [rows]);
    const [open, setOpen] = useState<Set<string>>(() => new Set(groups.slice(0, 1).map((group) => group.key)));

    if (rows.length === 0) {
        return <div className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">No results.</div>;
    }

    const columns = rows[0].getVisibleCells().map((cell) => cell.column.id);
    return (
        <div className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        {columns.map((id) => (
                            <TableHead key={id} className={cn("px-3 text-xs text-muted-foreground first:pl-4 last:pr-4", id === "size" && "text-right", id === "actions" && "w-px")}>
                                {CHAIN_HEADERS[id] ?? ""}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {groups.map((group, index) => {
                        const expanded = open.has(group.key);
                        const stored = group.rows.reduce((sum, row) => sum + row.original.file.size, 0);
                        const Chevron = expanded ? ChevronDown : ChevronRight;
                        return [
                            <TableRow
                                key={group.key}
                                className="cursor-pointer bg-muted/30 hover:bg-muted/50"
                                onClick={() => setOpen((current) => {
                                    const next = new Set(current);
                                    if (next.has(group.key)) next.delete(group.key);
                                    else next.add(group.key);
                                    return next;
                                })}
                            >
                                <TableCell colSpan={columns.length} className="px-4 py-2.5">
                                    <div className="flex items-center gap-3">
                                        <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card">
                                            <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <span className="block text-sm font-semibold">
                                                {group.key === "none" ? "Without a chain" : <>Chain of <DateDisplay date={madeAt(group.full.file)} format="P" /></>}
                                            </span>
                                            <span className="block truncate text-xs text-muted-foreground">
                                                {count(group.rows.length, "backup")}{index === 0 && group.key !== "none" ? " · the current chain" : ""}
                                            </span>
                                        </div>
                                        <span className="shrink-0 text-sm tabular-nums">
                                            <span className="font-medium">{formatBytes(stored, 1)}</span>
                                            <span className="text-muted-foreground"> stored</span>
                                        </span>
                                    </div>
                                </TableCell>
                            </TableRow>,
                            ...(expanded
                                ? group.rows.map((row) => (
                                    <TableRow
                                        key={row.id}
                                        onClick={() => onOpen(row.original)}
                                        data-state={row.original.path === openPath ? "selected" : undefined}
                                        className="group/row cursor-pointer [&>td]:px-3 [&>td]:py-2.5 [&>td:first-child]:pl-4 [&>td:last-child]:pr-4"
                                    >
                                        {row.getVisibleCells().map((cell) => (
                                            <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                                        ))}
                                    </TableRow>
                                ))
                                : []),
                        ];
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
