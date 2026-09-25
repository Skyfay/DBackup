"use client";

import { useMemo } from "react";
import { fromZonedTime } from "date-fns-tz";
import { Lock, Scissors, Unlink, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipHead, TooltipTrigger } from "@/components/ui/tooltip";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { cn } from "@/lib/utils";
import type { ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import { failedCheck, hasMissing } from "./backup-filters";
import { count } from "./explorer-format";
import type { CellKind, DayKey, DayTotal, TimelineCell, TimelineSpan } from "./timeline-model";

/** The days and times of the timeline in the formats and the time zone of the signed in user. */
export function useTimelineFormat() {
    const { formatDate, timezone } = useDateFormatter();
    return useMemo(() => {
        // The middle of the day, so the date is the same wherever the day is read.
        const noon = (day: DayKey) => fromZonedTime(`${day}T12:00:00`, timezone);
        return {
            dayOf: (iso: string): DayKey => formatDate(iso, "yyyy-MM-dd"),
            date: (day: DayKey) => `${formatDate(noon(day), "EEE")}, ${formatDate(noon(day), "P")}`,
            short: (day: DayKey) => formatDate(noon(day), "MMM d"),
            dateOf: (iso: string) => formatDate(iso, "P"),
            time: (iso: string) => formatDate(iso, "p"),
        };
    }, [formatDate, timezone]);
}

export type TimelineFormat = ReturnType<typeof useTimelineFormat>;

const KINDS: Record<CellKind, string> = {
    none: "",
    ok: "bg-foreground/55 text-card",
    full: "bg-foreground/85 text-card",
    incremental: "border-2 border-foreground/55",
    locked: "bg-foreground/55 text-card",
    missing: "border-2 border-warning bg-warning/20 text-warning",
    failed: "bg-destructive text-destructive-foreground",
    missed: "border-2 border-dashed border-destructive bg-destructive/10 text-destructive",
    planned: "border-[1.5px] border-dashed border-foreground/45 text-muted-foreground",
};

function mark(cell: TimelineCell): React.ReactNode {
    const many = cell.runs.length > 1 ? cell.runs.length : null;
    switch (cell.kind) {
        case "none":
            return <span className="size-1 rounded-full bg-foreground/20" />;
        case "full":
            return "F";
        case "locked":
            return <Lock className="size-3" aria-hidden="true" />;
        case "missed":
            return <X className="size-3" strokeWidth={3} aria-hidden="true" />;
        case "planned":
            return cell.planned.some((run) => run.full) ? "F" : cell.planned.length > 1 ? cell.planned.length : null;
        default:
            return many;
    }
}

/** What a cell tells on hover: the state first, tinted like every tooltip that tells one, then the facts. */
function CellTip({ cell, job, destinations, format, at }: {
    cell: TimelineCell;
    job: ExplorerJob;
    destinations: Map<string, ExplorerDestination>;
    format: TimelineFormat;
    at: string[];
}) {
    const date = format.date(cell.day);
    if (cell.kind === "planned") {
        const [first] = cell.planned;
        const title = cell.planned.length === 1 ? `Planned for ${date}, ${format.time(first.at)}` : `${cell.planned.length} runs planned on ${date}`;
        const fulls = cell.planned.filter((run) => run.full).length;
        // What ages out that day, summed per destination with the oldest backup.
        const aged = new Map<string, { count: number; oldest: string }>();
        for (const run of cell.planned) {
            for (const entry of run.agesOut ?? []) {
                const known = aged.get(entry.destinationId);
                aged.set(entry.destinationId, {
                    count: (known?.count ?? 0) + entry.count,
                    oldest: known && known.oldest < entry.oldest ? known.oldest : entry.oldest,
                });
            }
        }
        return (
            <>
                <p className="font-medium">{title}</p>
                <div className="mt-1 space-y-1 text-muted-foreground">
                    {fulls > 0 && <p>{cell.planned.length === 1 ? "A full backup starts a new chain." : "One of them starts a new chain with a full backup."}</p>}
                    {fulls === 0 && first.full === false && <p>{cell.planned.length === 1 ? "It adds to the running chain." : "They add to the running chain."}</p>}
                    {[...aged].map(([destinationId, entry]) => (
                        <p key={destinationId}>
                            At {destinations.get(destinationId)?.name ?? "a removed destination"}{" "}
                            {entry.count === 1 ? `the backup of ${format.dateOf(entry.oldest)} ages out.` : `${entry.count} backups age out, the oldest of ${format.dateOf(entry.oldest)}.`}
                        </p>
                    ))}
                </div>
            </>
        );
    }
    if (cell.kind === "missed" && cell.missed) {
        return (
            <>
                <TooltipHead tone="destructive">Run missed</TooltipHead>
                <p className="text-muted-foreground">
                    {cell.missed.runs === 1 ? `The run of ${date}, ${format.time(cell.missed.at)} did not start.` : `None of its runs of ${date} started.`}
                </p>
            </>
        );
    }
    const backups = `${count(cell.runs.length, "backup")} of ${job.name} on ${date}`;
    const missingAt = [...new Set(cell.runs.flatMap((run) => run.copies.filter((copy) => copy.state === "missing").map((copy) => copy.destinationId)))];
    return (
        <>
            {cell.kind === "failed" && <TooltipHead tone="destructive">Check failed</TooltipHead>}
            {cell.kind === "missing" && <TooltipHead tone="warning">Copy missing</TooltipHead>}
            <p className={cn(cell.kind !== "failed" && cell.kind !== "missing" && "font-medium")}>{backups}</p>
            <div className="mt-1 space-y-1 text-muted-foreground">
                {cell.kind === "failed" && <p>{count(cell.runs.filter((run) => failedCheck(run, at)).length, "backup")} failed the integrity check.</p>}
                {cell.kind === "missing" && missingAt.length > 0 && (
                    <p>{cell.runs.some((run) => hasMissing(run, at)) ? `Missing at ${missingAt.map((id) => destinations.get(id)?.name ?? "a removed destination").join(", ")}.` : null}</p>
                )}
                {cell.kind === "full" && <p>A full backup starts a chain that day.</p>}
                {cell.kind === "incremental" && <p>Incremental backups of a chain.</p>}
                {cell.kind === "locked" && <p>Locked, retention leaves it alone.</p>}
            </div>
        </>
    );
}

interface CellProps {
    cell: TimelineCell;
    job: ExplorerJob;
    destinations: Map<string, ExplorerDestination>;
    format: TimelineFormat;
    at: string[];
    picked: boolean;
    onPick: () => void;
}

/** A day of a job. One with backups lists them below on a click, the others only tell what they are on hover. */
export function TimelineCellButton({ cell, job, destinations, format, at, picked, onPick }: CellProps) {
    const pickable = cell.runs.length > 0;
    const button = (
        <button
            type="button"
            onClick={pickable ? onPick : undefined}
            aria-disabled={!pickable}
            aria-pressed={pickable ? picked : undefined}
            aria-label={`${job.name}, ${format.date(cell.day)}`}
            className={cn(
                "flex h-7 w-full min-w-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/50",
                KINDS[cell.kind],
                pickable ? "cursor-pointer hover:ring-2 hover:ring-foreground/30" : "cursor-default",
                picked && "ring-2 ring-foreground ring-offset-2 ring-offset-card hover:ring-foreground"
            )}
        >
            {mark(cell)}
        </button>
    );
    if (cell.kind === "none") return button;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent className="max-w-xs">
                <CellTip cell={cell} job={job} destinations={destinations} format={format} at={at} />
            </TooltipContent>
        </Tooltip>
    );
}

/** Days a row has nothing to show for, as one striped bar with what they mean. */
export function TimelineSpanBar({ span, job, retention }: { span: TimelineSpan; job: ExplorerJob; retention: string | null }) {
    const text = span.kind === "gone"
        ? `Job deleted · its ${count(job.runs, "backup")} stay until you delete them`
        : `Older backups aged out${retention ? `, the job keeps ${retention.charAt(0).toLowerCase()}${retention.slice(1)}` : ""}`;
    const Icon = span.kind === "gone" ? Unlink : Scissors;
    // A short span has no room for its words, the hover still names it.
    const wide = span.end - span.start >= 3;
    return (
        <span
            title={text}
            className="flex h-7 min-w-0 items-center justify-center gap-2 overflow-hidden rounded-md border border-dashed border-input bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_6px,transparent_6px_12px)] px-2 text-xs whitespace-nowrap text-muted-foreground"
            style={{ gridColumn: `${span.start + 2} / ${span.end + 3}` }}
        >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            {wide ? <span className="truncate">{text}</span> : <span className="sr-only">{text}</span>}
        </span>
    );
}

const WORST: Record<DayTotal["worst"], string> = { ok: "bg-foreground/55", warning: "bg-warning", destructive: "bg-destructive" };

/** A day in the row of every job: how many backups, as a bar in the color of the worst of them. */
export function TimelineTotal({ total, peak, picked, onPick, format }: {
    total: DayTotal;
    peak: number;
    picked: boolean;
    onPick: () => void;
    format: TimelineFormat;
}) {
    const height = total.count === 0 ? 0 : Math.max(4, Math.round((total.count / Math.max(peak, 1)) * 26));
    const pickable = !total.planned && total.count > 0;
    return (
        <button
            type="button"
            onClick={pickable ? onPick : undefined}
            aria-disabled={!pickable}
            aria-pressed={pickable ? picked : undefined}
            aria-label={`${total.planned ? `${total.count} planned` : count(total.count, "backup")}, ${format.date(total.day)}`}
            className={cn(
                "flex h-10 min-w-0 flex-col items-center justify-end gap-0.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                pickable ? "cursor-pointer" : "cursor-default",
                picked && "ring-2 ring-foreground"
            )}
        >
            <span className={cn("text-[10px] tabular-nums", total.planned ? "text-muted-foreground/70" : "text-muted-foreground")}>{total.count || ""}</span>
            {height > 0 && (
                <span
                    className={cn("w-3/4 rounded-t-sm", total.planned ? "border-[1.5px] border-b-0 border-dashed border-foreground/45" : WORST[total.worst])}
                    style={{ height }}
                />
            )}
        </button>
    );
}

/** What the marks of the timeline mean, in its foot. */
export function TimelineLegend() {
    const swatch = "flex h-3 w-3.5 shrink-0 items-center justify-center rounded-[4px]";
    return (
        <>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, "bg-foreground/55")} />Backup</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, "bg-foreground/85 text-[8px] font-bold text-card")}>F</span>Full</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, "border-2 border-foreground/55")} />Incremental</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, "border-2 border-warning bg-warning/20")} />Copy missing</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, "bg-destructive")} />Check failed</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, "border-2 border-dashed border-destructive")} />Run missed</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, "border-[1.5px] border-dashed border-foreground/55")} />Planned</span>
        </>
    );
}
