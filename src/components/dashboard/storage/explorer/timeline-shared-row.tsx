"use client";

import { formerLabel, isFormer } from "@/components/dashboard/shared/shared-model";
import { Tooltip, TooltipContent, TooltipHead, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import { count } from "./explorer-format";
import { SharedTile } from "./shared-run-cells";
import type { TimelineFormat } from "./timeline-cells";
import { isPicked, type DayKey, type TimelineCell, type TimelinePick, type TimelineRow, type TimelineSpan } from "./timeline-model";

/** A day of a shared database is dashed, so it is told apart from a day of an own job. */
const KINDS = {
    ok: "border-[1.5px] border-dashed border-foreground/55 bg-foreground/8",
    failed: "border-[1.5px] border-dashed border-destructive bg-destructive/12 text-destructive",
} as const;

/** The mark of a day with a backup of a shared database, for the foot of the timeline. */
export function SharedSwatch() {
    return <span className={cn("h-3 w-3.5 shrink-0 rounded-[4px]", KINDS.ok)} />;
}

function SharedCellButton({ cell, database, format, picked, onPick }: {
    cell: TimelineCell;
    database: SharedDatabase;
    format: TimelineFormat;
    picked: boolean;
    onPick: (anchor: HTMLElement) => void;
}) {
    const pickable = cell.runs.length > 0;
    const button = (
        <button
            type="button"
            onClick={pickable ? (event) => onPick(event.currentTarget) : undefined}
            aria-disabled={!pickable}
            aria-haspopup={pickable ? "dialog" : undefined}
            aria-expanded={pickable ? picked : undefined}
            aria-label={`${database.databaseName}, ${format.date(cell.day)}`}
            className={cn(
                "flex h-7 w-full min-w-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/50",
                pickable && KINDS[cell.kind === "failed" ? "failed" : "ok"],
                pickable ? "cursor-pointer hover:ring-2 hover:ring-foreground/30" : "cursor-default",
                picked && "ring-2 ring-foreground ring-offset-2 ring-offset-card hover:ring-foreground"
            )}
        >
            {!pickable ? <span className="size-1 rounded-full bg-foreground/20" /> : cell.runs.length > 1 ? cell.runs.length : null}
        </button>
    );
    if (!pickable) return button;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent className="max-w-xs">
                {cell.kind === "failed" && <TooltipHead tone="destructive">Check failed</TooltipHead>}
                <p className={cn(cell.kind !== "failed" && "font-medium")}>{count(cell.runs.length, "backup")} of {database.databaseName} on {format.date(cell.day)}</p>
                <p className="mt-1 text-muted-foreground">Made by {database.providerName} or with Back up now. They lie in its archive.</p>
            </TooltipContent>
        </Tooltip>
    );
}

/** Days the database was not the tenant's, as one dashed bar. */
function SharedSpanBar({ span, database, format }: { span: TimelineSpan; database: SharedDatabase; format: TimelineFormat }) {
    const text = span.kind === "before" ? `Yours from ${format.dateOf(database.since)}` : `No longer yours since ${format.dateOf(database.until ?? database.since)}`;
    return (
        <span
            title={text}
            className="flex h-7 min-w-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-input px-2 text-xs whitespace-nowrap text-muted-foreground"
            style={{ gridColumn: `${span.start + 2} / ${span.end + 3}` }}
        >
            {span.end - span.start >= 3 ? <span className="truncate">{text}</span> : <span className="sr-only">{text}</span>}
        </span>
    );
}

interface TimelineSharedRowProps {
    row: TimelineRow;
    database: SharedDatabase;
    /** The days in view up to today, which a click on the database lists. */
    range: { from: DayKey; to: DayKey };
    template: React.CSSProperties;
    format: TimelineFormat;
    pick: TimelinePick | null;
    onToggle: (pick: TimelinePick, anchor: HTMLElement) => void;
}

/** A shared database of the timeline, after the jobs: its name with its provider, which lists its backups in view, and a dashed cell per day. */
export function TimelineSharedRow({ row, database, range, template, format, pick, onToggle }: TimelineSharedRowProps) {
    const key = row.job.key;
    const lanePicked = isPicked(pick, key, range.from, range.to);
    const former = isFormer(database);
    return (
        <div className={cn("relative grid items-center border-b px-5 py-2 last:border-b-0", lanePicked && "bg-foreground/[0.045]")} style={template}>
            <button
                type="button"
                onClick={(event) => onToggle({ jobKey: key, ...range }, event.currentTarget)}
                aria-haspopup="dialog"
                aria-expanded={lanePicked}
                className="flex min-w-0 items-center gap-2.5 rounded-md pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
                <SharedTile adapterId={database.adapterId} />
                <span className="min-w-0">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className={cn("truncate text-sm font-medium", former && "text-muted-foreground")}>{database.databaseName}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">· {former ? formerLabel(database) : "Shared"}</span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{database.serverName} · by {database.providerName}</span>
                </span>
            </button>
            {row.cells.map((cell, index) => {
                if (cell) {
                    return (
                        <SharedCellButton
                            key={cell.day}
                            cell={cell}
                            database={database}
                            format={format}
                            picked={isPicked(pick, key, cell.day, cell.day)}
                            onPick={(anchor) => onToggle({ jobKey: key, from: cell.day, to: cell.day }, anchor)}
                        />
                    );
                }
                const span = row.spans.find((entry) => entry.start === index);
                return span ? <SharedSpanBar key={`span-${index}`} span={span} database={database} format={format} /> : null;
            })}
        </div>
    );
}
