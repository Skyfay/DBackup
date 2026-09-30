"use client";

import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface StripCell {
    label: string;
    /** The icon of what the number counts, like the icon of its tab or its kind elsewhere. */
    icon: LucideIcon;
    value: React.ReactNode;
    /** Split off the value in muted text, like "GB" or "ago". */
    unit?: string;
    /** What the number means in a sentence: on hover from md up, under the label on a phone. */
    extra?: React.ReactNode;
    /** Red for what fails, amber for what will or might, green for the share that went well. */
    tone?: "warning" | "destructive" | "success";
}

const ICON_TONES: Record<NonNullable<StripCell["tone"]>, string> = {
    warning: "bg-warning/14 text-warning",
    destructive: "bg-destructive/14 text-destructive",
    success: "bg-success/14 text-success",
};

/** A loading cell holds a space, which needs no hover. */
const hasExtra = (extra: React.ReactNode) => extra !== undefined && extra !== null && extra !== false && !(typeof extra === "string" && extra.trim() === "");

function StripTile({ cell, joined }: { cell: StripCell; joined: boolean }) {
    const Icon = cell.icon;
    const extra = hasExtra(cell.extra);
    const tile = (
        <div className={cn("flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-card-foreground", joined && "md:border-transparent md:bg-foreground/4")}>
            <span className={cn("flex size-8.5 shrink-0 items-center justify-center rounded-md", cell.tone ? ICON_TONES[cell.tone] : "bg-muted text-muted-foreground")} aria-hidden="true">
                <Icon className="size-4" />
            </span>
            <div className="min-w-0">
                <div
                    className={cn(
                        "flex min-w-0 items-baseline gap-1 text-lg leading-5 font-semibold tracking-tight tabular-nums",
                        cell.tone === "warning" && "text-warning",
                        cell.tone === "destructive" && "text-destructive"
                    )}
                >
                    <span className="truncate">{cell.value}</span>
                    {cell.unit && <span className="truncate text-xs font-normal text-muted-foreground">{cell.unit}</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{cell.label}</div>
                {/* A phone has no hover, so the sentence stays under the label there. */}
                {extra && <div className="truncate text-xs text-muted-foreground md:sr-only">{cell.extra}</div>}
            </div>
        </div>
    );
    if (!extra) return tile;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{tile}</TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-80">{cell.extra}</TooltipContent>
        </Tooltip>
    );
}

/**
 * The headline numbers of a list or a record, a tile each with its icon, the number and what it
 * counts, and what it means in a sentence on hover. `joined` makes it the row between the tabs of a
 * page and its list from md up, see `PageHead`: the tiles sit a shade above the card there, without
 * a border. On the page, like on a phone or the page of a record, they are cards of their own. From
 * md up the tiles share one row, on a phone two share one and an odd last one takes the whole row.
 */
export function ExplorerStrip({ cells, joined = false }: { cells: StripCell[]; joined?: boolean }) {
    return (
        <div
            className={cn(
                "grid grid-cols-2 gap-2 md:auto-cols-fr md:grid-flow-col md:grid-cols-none md:gap-3 [&>*:last-child:nth-child(odd)]:col-span-2 md:[&>*:last-child:nth-child(odd)]:col-span-1",
                joined && "md:border-x md:bg-card md:px-4 md:pt-4 md:pb-1"
            )}
        >
            {cells.map((cell) => (
                <StripTile key={cell.label} cell={cell} joined={joined} />
            ))}
        </div>
    );
}
