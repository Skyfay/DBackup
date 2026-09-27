"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import type { TimelineFormat } from "@/components/dashboard/storage/explorer/timeline-cells";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipHead, TooltipTrigger } from "@/components/ui/tooltip";
import { PAGE_SIZES } from "@/lib/core/table-preferences";
import { cn } from "@/lib/utils";
import type { ExplorerDbJob, VersionChange } from "@/services/databases/database-explorer-types";
import { markOf, type DatabaseCell } from "./database-model";

const KINDS: Record<DatabaseCell["kind"], string> = {
    none: "",
    ok: "bg-foreground/55 text-card",
    mixed: "bg-foreground/55 text-card",
    failed: "bg-destructive text-destructive-foreground",
    running: "animate-pulse bg-foreground/25",
    planned: "border-[1.5px] border-dashed border-foreground/45 text-muted-foreground",
};

function CellTip({ cell, name, changes, jobsById, format }: {
    cell: DatabaseCell;
    name: string;
    changes?: VersionChange[];
    jobsById: Map<string, ExplorerDbJob>;
    format: TimelineFormat;
}) {
    const ok = cell.runs.filter((run) => run.status === "Success" || run.status === "Partial");
    const failed = cell.runs.filter((run) => run.status === "Failed");
    const jobName = (id: string) => jobsById.get(id)?.name ?? "A deleted job";
    return (
        <>
            {failed.length > 0 && <TooltipHead tone="destructive">{failed.length === 1 ? "A run failed" : `${failed.length} runs failed`}</TooltipHead>}
            <p className={cn(failed.length === 0 && "font-medium")}>{name}, {format.date(cell.day)}</p>
            <div className="mt-1 space-y-1 text-muted-foreground">
                {ok.length > 0 && <p>{count(ok.length, "backup")} of it.</p>}
                {cell.runs.slice(0, 3).map((run) => (
                    <p key={run.id} className="truncate">{format.time(run.startedAt)} · {jobName(run.jobId)} · {run.status === "Partial" ? "a copy failed" : run.status.toLowerCase()}</p>
                ))}
                {cell.runs.length > 3 && <p>and {count(cell.runs.length - 3, "more run")}.</p>}
                {cell.planned.length > 0 && (
                    <p>{count(cell.planned.length, "run")} planned, the first at {format.time(cell.planned[0].at)} by {jobName(cell.planned[0].jobId)}.</p>
                )}
                {changes?.map((change) => <p key={change.detectedAt}>A new version, {change.previousVersion} → {change.newVersion}.</p>)}
            </div>
        </>
    );
}

/**
 * A day of a database or of a folded server: gray for a backup, red for a failure, dashed for a
 * plan. A click shows its backups beside the timeline. A folded server marks a new version on it.
 */
export function Cell({ cell, name, changes, jobsById, format, picked, onPick }: {
    cell: DatabaseCell;
    name: string;
    changes?: VersionChange[];
    jobsById: Map<string, ExplorerDbJob>;
    format: TimelineFormat;
    picked: boolean;
    onPick: () => void;
}) {
    if (cell.kind === "none" && !changes?.length) {
        return (
            <span className="flex h-7 w-full min-w-0 items-center justify-center" aria-hidden="true">
                <span className="size-1 rounded-full bg-foreground/20" />
            </span>
        );
    }
    const failed = cell.runs.filter((run) => run.status === "Failed").length;
    const ok = cell.runs.length - failed;
    const number = cell.kind === "failed" ? (failed > 1 ? failed : null) : cell.kind === "planned" ? (cell.planned.length > 1 ? cell.planned.length : null) : ok > 1 ? ok : null;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    onClick={onPick}
                    aria-pressed={picked}
                    aria-label={`${name}, ${format.date(cell.day)}`}
                    className={cn(
                        "relative flex h-7 w-full min-w-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums outline-none transition-shadow hover:ring-2 hover:ring-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/50",
                        KINDS[cell.kind],
                        cell.kind === "ok" && ok > 1 && "bg-foreground/85",
                        picked && "ring-2 ring-foreground ring-offset-2 ring-offset-card hover:ring-foreground"
                    )}
                >
                    {cell.kind === "none" ? <span className="size-1 rounded-full bg-foreground/20" /> : number}
                    {cell.kind === "mixed" && <span className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-card bg-destructive" aria-hidden="true" />}
                    {changes && changes.length > 0 && (
                        <span className="absolute -top-1.5 -left-1.5 flex size-4 items-center justify-center rounded-full border bg-card text-foreground" aria-hidden="true">
                            <ArrowUp className="size-2.5" />
                        </span>
                    )}
                </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
                <CellTip cell={cell} name={name} changes={changes} jobsById={jobsById} format={format} />
            </TooltipContent>
        </Tooltip>
    );
}

/**
 * The version a server was updated to on a day, small enough for the column of that day, so updates
 * on days in a row sit beside each other. More than one change that day shows as a count, the
 * hover names each.
 */
export function VersionMark({ changes, format }: { changes: VersionChange[]; format: TimelineFormat }) {
    const { latest, earlier } = markOf(changes);
    const Arrow = latest.downgrade ? ArrowDown : ArrowUp;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    tabIndex={0}
                    aria-label={`${latest.downgrade ? "Downgraded" : "Updated"} to ${latest.newVersion}`}
                    className={cn(
                        "inline-flex h-5 max-w-full min-w-0 items-center gap-0.5 rounded-md border bg-card px-1 text-[10.5px] font-semibold tabular-nums shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        latest.downgrade && "border-warning/60 text-warning"
                    )}
                >
                    <Arrow className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{latest.newVersion}</span>
                    {earlier > 0 && <span className="shrink-0 text-muted-foreground">+{earlier}</span>}
                </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
                {latest.downgrade && <TooltipHead tone="warning">An older version than before</TooltipHead>}
                <p className={cn(!latest.downgrade && "font-medium")}>{changes.length === 1 ? "A new version" : `${changes.length} new versions`}, {format.dateOf(latest.detectedAt)}</p>
                <div className="mt-1 space-y-1 text-muted-foreground">
                    {changes.map((change) => (
                        <p key={change.detectedAt}>{change.previousVersion} → {change.newVersion}, read at {format.time(change.detectedAt)}</p>
                    ))}
                    <p>Backups made after it are only restored onto this version or a newer one.</p>
                </div>
            </TooltipContent>
        </Tooltip>
    );
}

/** The pages of the timeline, cut like the ones of the table and as many rows long. */
export function TimelinePager({ first, last, total, page, pages, size, onPage, onSize }: {
    first: number;
    last: number;
    total: string;
    page: number;
    pages: number;
    size: number;
    onPage: (page: number) => void;
    onSize: (size: number) => void;
}) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t px-5 py-3 text-sm text-muted-foreground">
            <span className="tabular-nums">{first.toLocaleString()} to {last.toLocaleString()} of {total}</span>
            <div className="flex items-center gap-4">
                <div className="hidden items-center gap-2 sm:flex">
                    <span className="font-medium text-foreground">Rows per page</span>
                    <Select value={String(size)} onValueChange={(value) => onSize(Number(value))}>
                        <SelectTrigger size="sm" className="h-8 w-17.5" aria-label="Rows per page">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent side="top">
                            {PAGE_SIZES.map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <span className="font-medium text-foreground tabular-nums">Page {page + 1} of {pages}</span>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" className="size-8" aria-label="Previous page" onClick={() => onPage(page - 1)} disabled={page <= 0}>
                        <ChevronLeft />
                    </Button>
                    <Button variant="outline" size="icon" className="size-8" aria-label="Next page" onClick={() => onPage(page + 1)} disabled={page >= pages - 1}>
                        <ChevronRight />
                    </Button>
                </div>
            </div>
        </div>
    );
}
