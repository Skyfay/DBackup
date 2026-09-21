import { cn, formatBytes, formatDuration } from "@/lib/utils";
import type { DashboardStrip } from "@/services/dashboard/types";

interface StatProps {
    label: string;
    value: string;
    valueClassName?: string;
    extra?: string;
}

function Stat({ label, value, valueClassName, extra }: StatProps) {
    return (
        <div className="min-w-0 bg-card px-4 py-3">
            <div className="truncate text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
                <span className={cn("text-lg font-semibold tabular-nums", valueClassName)}>{value}</span>
                {extra && <span className="truncate text-xs text-muted-foreground tabular-nums">{extra}</span>}
            </div>
        </div>
    );
}

/**
 * Secondary counts in one bordered strip. The 1px gaps over a border-colored background draw the
 * dividers. Eight values fill two, four or eight columns without an empty cell: setup and health
 * first, activity second.
 */
export function StatsStrip({ strip }: { strip: DashboardStrip }) {
    const [backedUpValue, backedUpUnit] = formatBytes(strip.backedUp24h, 1).split(" ");

    return (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-sm md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Total jobs" value={strip.totalJobs.toLocaleString()} />
            <Stat label="Active schedules" value={strip.activeSchedules.toLocaleString()} />
            <Stat label="Encrypted jobs" value={strip.encryptedJobs.toLocaleString()} extra={`of ${strip.totalJobs.toLocaleString()}`} />
            <Stat
                label="Offline connections"
                value={strip.offlineConnections.toLocaleString()}
                valueClassName={strip.offlineConnections > 0 ? "text-warning" : undefined}
                extra={`of ${strip.connections.toLocaleString()}`}
            />
            <Stat
                label="Running now"
                value={strip.runningNow.toLocaleString()}
                valueClassName={strip.runningNow > 0 ? "text-info" : undefined}
                extra={strip.queuedNow > 0 ? `+${strip.queuedNow} queued` : undefined}
            />
            <Stat label="Succeeded, 24h" value={strip.succeeded24h.toLocaleString()} />
            <Stat label="Backed up, 24h" value={backedUpValue} extra={backedUpUnit} />
            <Stat label="Avg duration" value={strip.avgDurationMs === null ? "-" : formatDuration(strip.avgDurationMs)} />
        </div>
    );
}
