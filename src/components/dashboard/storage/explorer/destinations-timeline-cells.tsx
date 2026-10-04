"use client";

import { Scissors, Unplug, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipHead, TooltipTrigger } from "@/components/ui/tooltip";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { ExplorerDestination } from "@/services/storage/explorer-types";
import { count } from "./explorer-format";
import type { TimelineFormat } from "./timeline-cells";
import type { DayKey } from "./timeline-model";

/**
 * The cells of the timeline of the Destinations tab, a day of one destination each, apart from
 * the timeline that lays them out.
 */

/** `away` is a day an air-gapped destination was not connected, which is how it is meant to be. */
export type Kind = "none" | "in" | "missing" | "offline" | "away" | "planned";

export interface DayCell {
    day: DayKey;
    kind: Kind;
    /** Backups that arrived that day, or are planned to arrive. */
    arrived: number;
    missing: number;
    /** Backups that ran without the air-gapped destination while it was not connected. */
    away: number;
    /** Backups the retention removes after the runs of that day. */
    leaving: number;
    /** How many jobs the planned backups come from. */
    jobs: number;
}

const KINDS: Record<Kind, string> = {
    none: "",
    in: "bg-foreground/55 text-card",
    missing: "border-2 border-warning bg-warning/20 text-warning",
    offline: "border-2 border-dashed border-destructive bg-destructive/10 text-destructive",
    away: "border border-dashed border-muted-foreground/45 text-muted-foreground",
    planned: "border-[1.5px] border-dashed border-foreground/45 text-muted-foreground",
};

function CellTip({ cell, destination, format }: { cell: DayCell; destination: ExplorerDestination; format: TimelineFormat }) {
    const title = `${format.date(cell.day)} at ${destination.name}`;
    if (cell.kind === "planned") {
        return (
            <>
                <p className="font-medium">{title}</p>
                <div className="mt-1 space-y-1 text-muted-foreground">
                    <p>{count(cell.arrived, "backup")} arrive from {count(cell.jobs, "job")}.</p>
                    {cell.leaving > 0 && <p>{count(cell.leaving, "backup")} age out with the retention.</p>}
                </div>
            </>
        );
    }
    if (cell.kind === "away") {
        return (
            <>
                {/* Away is how an air-gapped destination is meant to be, so its head stays neutral. */}
                <div className="-mx-3 -mt-2 mb-1.5 flex min-w-0 items-center gap-2 rounded-t-[7px] border-b px-3 py-1.5 font-semibold">
                    <Unplug className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    Not connected
                </div>
                <p>{title}</p>
                <div className="mt-1 space-y-1 text-muted-foreground">
                    <p>{cell.away > 0 ? `It is air-gapped. ${count(cell.away, "backup")} ran without it, nothing is missing.` : "It is air-gapped and was not connected."}</p>
                    {destination.health.answeredAt && <p>Last connected <DateDisplay date={destination.health.answeredAt} format="Pp" />.</p>}
                </div>
            </>
        );
    }
    return (
        <>
            {cell.kind === "offline" && <TooltipHead tone="destructive">Does not answer</TooltipHead>}
            {cell.kind === "missing" && <TooltipHead tone="warning">A copy is missing</TooltipHead>}
            <p className={cn(cell.kind !== "offline" && cell.kind !== "missing" && "font-medium")}>{title}</p>
            <div className="mt-1 space-y-1 text-muted-foreground">
                <p>{cell.arrived === 0 ? "No backup arrived." : `${count(cell.arrived, "backup")} arrived.`}</p>
                {cell.missing > 0 && <p>{count(cell.missing, "copy", "copies")} of that day missing here.</p>}
                {cell.kind === "offline" && <p>Backups that should arrive fail until it answers.</p>}
            </div>
        </>
    );
}

/** One day of one destination: what arrived or was missed, with the explanation on hover. */
export function DestinationDayCell({ cell, destination, format, picked, onPick }: { cell: DayCell; destination: ExplorerDestination; format: TimelineFormat; picked: boolean; onPick: () => void }) {
    const number = cell.arrived > 1 ? cell.arrived : null;
    const button = (
        <button
            type="button"
            onClick={onPick}
            aria-label={`${destination.name}, ${format.date(cell.day)}`}
            className={cn(
                "relative flex h-7 w-full min-w-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums outline-none transition-shadow hover:ring-2 hover:ring-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/50",
                KINDS[cell.kind],
                cell.kind === "in" && cell.arrived > 1 && "bg-foreground/85",
                picked && "ring-2 ring-foreground/40"
            )}
        >
            {cell.kind === "none" ? (
                <span className="size-1 rounded-full bg-foreground/20" />
            ) : cell.kind === "offline" && !number ? (
                <X className="size-3" strokeWidth={3} />
            ) : cell.kind === "away" ? (
                <Unplug className="size-3" aria-hidden="true" />
            ) : (
                number
            )}
            {cell.kind === "planned" && cell.leaving > 0 && (
                <span className="absolute -top-1.5 -right-1 flex size-3.5 items-center justify-center rounded-full bg-card" aria-hidden="true">
                    <Scissors className="size-2.5 text-muted-foreground" />
                </span>
            )}
        </button>
    );
    if (cell.kind === "none") return button;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent className="max-w-xs">
                <CellTip cell={cell} destination={destination} format={format} />
            </TooltipContent>
        </Tooltip>
    );
}

