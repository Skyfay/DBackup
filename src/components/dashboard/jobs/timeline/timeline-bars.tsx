"use client";

import { Tooltip, TooltipContent, TooltipHead, TooltipTrigger } from "@/components/ui/tooltip";
import { stageLabel } from "@/lib/core/logs";
import { cn } from "@/lib/utils";
import type { BarGroup, BarKind, TimelineBar, TimeRange } from "./job-timeline-model";
import { aboutLength, type TimelineClock } from "./timeline-clock";

/** A run that is over, filled in the color of its outcome. */
const FILLED: Partial<Record<BarKind, string>> = {
    success: "bg-success/85",
    failed: "bg-destructive",
    partial: "bg-warning",
    cancelled: "bg-muted-foreground/40",
};
/** The time a run waits for a slot of the queue. */
export const HATCH = "bg-[repeating-linear-gradient(135deg,var(--warning)_0_3px,transparent_3px_6px)] opacity-75";
const PLANNED = "border-[1.5px] border-dashed border-foreground/45";
const LIKELY = "border-[1.5px] border-dashed border-destructive";

export const percentOf = (time: number, range: TimeRange) => ((time - range.from) / (range.to - range.from)) * 100;

function waitText(bar: TimelineBar, names: Map<string, string>): string {
    const jobs = (bar.run?.waitsFor ?? bar.planned?.waitsFor ?? []).map((id) => names.get(id) ?? "another job");
    return jobs.length > 0 ? `${jobs.join(", ")} ${jobs.length === 1 ? "holds" : "hold"} the queue` : "The queue is full";
}

/** What a run tells on hover: its state first, tinted like every tooltip that tells one, then the facts. */
function BarTip({ group, clock, names, estimate, opens }: { group: BarGroup; clock: TimelineClock; names: Map<string, string>; estimate: number; opens: boolean }) {
    const [bar] = group.bars;
    if (group.bars.length > 1) {
        return (
            <>
                <p className="font-medium">{group.bars.length} runs</p>
                <p className="text-muted-foreground">{clock.dayAndTime(group.start)} to {clock.time(group.end)}</p>
            </>
        );
    }
    const took = aboutLength(bar.end - bar.start);
    switch (bar.kind) {
        case "running":
            return (
                <>
                    <p className="font-medium">Running since {clock.time(bar.start)}</p>
                    <div className="mt-1 space-y-1 text-muted-foreground">
                        {bar.run?.stage && <p>{stageLabel(bar.run.stage)}{bar.run.progress !== null ? ` · ${bar.run.progress}%` : ""}</p>}
                        <p>Usually takes {aboutLength(estimate)}, so it ends about {clock.time(bar.end)}.</p>
                    </div>
                </>
            );
        case "pending":
            return (
                <>
                    <TooltipHead tone="warning">Waits in the queue</TooltipHead>
                    <div className="space-y-1 text-muted-foreground">
                        <p>Queued at {clock.time(bar.waitFrom ?? bar.start)}, starts about {clock.time(bar.start)}.</p>
                        <p>{waitText(bar, names)}.</p>
                    </div>
                </>
            );
        case "planned":
        case "likely":
            return (
                <>
                    {bar.kind === "likely" && <TooltipHead tone="destructive">Its last run failed</TooltipHead>}
                    <p className="font-medium">Planned for {clock.dayAndTime(bar.waitFrom ?? bar.start)}</p>
                    <div className="mt-1 space-y-1 text-muted-foreground">
                        <p>Takes about {took}, like its last runs.</p>
                        {bar.waitFrom !== null && <p>Waits about {aboutLength(bar.start - bar.waitFrom)} for a slot. {waitText(bar, names)}.</p>}
                    </div>
                </>
            );
        default: {
            const head = { success: null, cancelled: null, failed: "Failed", partial: "Partial" }[bar.kind as "success" | "cancelled" | "failed" | "partial"];
            return (
                <>
                    {head ? <TooltipHead tone={bar.kind === "failed" ? "destructive" : "warning"}>{head}</TooltipHead> : <p className="font-medium">{bar.kind === "success" ? "Succeeded" : "Cancelled"}</p>}
                    <div className="space-y-1 text-muted-foreground">
                        <p>{clock.dayAndTime(bar.start)} · took {took}</p>
                        {opens && <p>A click opens the run.</p>}
                    </div>
                </>
            );
        }
    }
}

interface BarGroupProps {
    group: BarGroup;
    /** Names the bar for screen readers, which hear it apart from its row. */
    jobName: string;
    range: TimeRange;
    now: number;
    clock: TimelineClock;
    names: Map<string, string>;
    estimate: number;
    /** Whether a click on a run that is over opens its page. */
    opensRuns: boolean;
    onOpen: (bar: TimelineBar) => void;
}

/** One run of a job, or several close together, placed at its time in the track of its row. */
export function TimelineBarGroup({ group, jobName, range, now, clock, names, estimate, opensRuns, onOpen }: BarGroupProps) {
    const [bar] = group.bars;
    const begin = Math.max(bar.waitFrom ?? group.start, range.from);
    const finish = Math.min(Math.max(group.end, group.start), range.to);
    const left = percentOf(begin, range);
    const width = Math.max(percentOf(finish, range) - left, 0);
    // The part of the bar between two times, in percent of the bar.
    const share = (from: number, to: number) => Math.max(0, ((Math.min(to, finish) - Math.max(from, begin)) / (finish - begin || 1)) * 100);
    const waits = bar.waitFrom !== null && group.bars.length === 1 ? share(bar.waitFrom, bar.start) : 0;
    const done = bar.kind === "running" ? share(bar.start, now) : 0;
    const filled = FILLED[bar.kind];
    const label = `${jobName}, ${group.bars.length > 1 ? `${group.bars.length} runs` : { success: "Succeeded", failed: "Failed", partial: "Partial", cancelled: "Cancelled", running: "Running", pending: "Waits in the queue", planned: "Planned", likely: "Planned, its last run failed" }[bar.kind]}, ${clock.dayAndTime(bar.waitFrom ?? bar.start)}`;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    onClick={() => onOpen(bar)}
                    aria-label={label}
                    className="absolute top-1/2 flex h-5 min-w-[3px] -translate-y-1/2 overflow-hidden rounded-[4px] outline-none transition-shadow hover:ring-2 hover:ring-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/50"
                    style={{ left: `${left}%`, width: `${width}%` }}
                >
                    {waits > 0 && <span className={cn("h-full shrink-0", HATCH)} style={{ width: `${waits}%` }} />}
                    {done > 0 && <span className="h-full shrink-0 bg-info" style={{ width: `${done}%` }} />}
                    <span
                        className={cn(
                            "h-full min-w-[3px] flex-1 rounded-[inherit]",
                            filled ?? (bar.kind === "running" ? "border-[1.5px] border-dashed border-info" : bar.kind === "likely" ? LIKELY : PLANNED),
                            waits > 0 && "rounded-l-none",
                            done > 0 && "rounded-l-none border-l-0",
                            group.bars.length > 1 && filled && "opacity-70"
                        )}
                    />
                </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
                <BarTip group={group} clock={clock} names={names} estimate={estimate} opens={opensRuns} />
            </TooltipContent>
        </Tooltip>
    );
}

/** What the marks of the timeline mean, in its foot. */
export function TimelineLegend() {
    const swatch = "inline-block h-2.5 w-4 shrink-0 rounded-[3px]";
    return (
        <>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, "bg-success/85")} />Succeeded</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, "bg-destructive")} />Failed</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, "bg-warning")} />Partial</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, "bg-info")} />Running</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, HATCH)} />Waits in the queue</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, PLANNED)} />Planned</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn(swatch, LIKELY)} />Planned, its last run failed</span>
        </>
    );
}
