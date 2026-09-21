import { cn, formatDuration } from "@/lib/utils";
import type { DashboardStrip } from "@/services/dashboard/types";

interface StatProps {
    label: string;
    value: string;
    valueClassName?: string;
    extra?: string;
    className?: string;
}

function Stat({ label, value, valueClassName, extra, className }: StatProps) {
    return (
        <div className={cn("min-w-0 bg-card px-4 py-3", className)}>
            <div className="truncate text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
                <span className={cn("text-lg font-semibold tabular-nums", valueClassName)}>{value}</span>
                {extra && <span className="truncate text-xs text-muted-foreground">{extra}</span>}
            </div>
        </div>
    );
}

/** Secondary counts in one bordered strip. The 1px gaps over a border-colored background draw the dividers. */
export function StatsStrip({ strip }: { strip: DashboardStrip }) {
    return (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-sm md:grid-cols-5">
            <Stat label="Total jobs" value={strip.totalJobs.toLocaleString()} />
            <Stat label="Active schedules" value={strip.activeSchedules.toLocaleString()} />
            <Stat label="Succeeded, 24h" value={strip.succeeded24h.toLocaleString()} />
            <Stat
                label="Running now"
                value={strip.runningNow.toLocaleString()}
                valueClassName={strip.runningNow > 0 ? "text-info" : undefined}
                extra={strip.queuedNow > 0 ? `+${strip.queuedNow} queued` : undefined}
            />
            <Stat
                label="Avg duration"
                value={strip.avgDurationMs === null ? "-" : formatDuration(strip.avgDurationMs)}
                className="col-span-2 md:col-span-1"
            />
        </div>
    );
}
