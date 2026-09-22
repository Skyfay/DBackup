"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { HealthHistoryGrid } from "@/components/adapter/health-history-grid";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { HealthBucket } from "@/services/adapters/connection-overview";

export type ConnectionHealth = "ONLINE" | "DEGRADED" | "OFFLINE" | "PENDING";

const HEALTH: Record<ConnectionHealth, { label: string; dot: string; text: string }> = {
    ONLINE: { label: "Online", dot: "bg-success", text: "text-foreground" },
    DEGRADED: { label: "Degraded", dot: "bg-warning", text: "text-warning" },
    OFFLINE: { label: "Offline", dot: "bg-destructive", text: "text-destructive" },
    PENDING: { label: "Not checked", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

const BUCKETS: Record<HealthBucket, string> = {
    ok: "bg-success",
    failed: "bg-warning",
    offline: "bg-destructive",
    none: "bg-muted",
};

const RUNS: Record<string, string> = {
    Success: "bg-success",
    Partial: "bg-warning",
    Failed: "bg-destructive",
};

export function Muted({ children }: { children: React.ReactNode }) {
    return <span className="text-sm text-muted-foreground">{children}</span>;
}

interface NameCellProps {
    adapterId: string;
    name: string;
    kind: string;
    compact: boolean;
    /** Opens the details. The whole row does it too, the button is the way in for keyboards. */
    onOpen?: () => void;
}

/** Icon, name and the kind of adapter. Compact rows put the kind beside the name instead of under it. */
export function NameCell({ adapterId, name, kind, compact, onOpen }: NameCellProps) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <span className={cn("flex shrink-0 items-center justify-center rounded-lg border bg-muted/50", compact ? "size-7" : "size-8")}>
                <AdapterIcon adapterId={adapterId} className="size-4" />
            </span>
            {/* A cell grows with text that never wraps, so a long name is capped here and cut off. */}
            <div className={cn("min-w-0 max-w-72", compact && "flex items-baseline gap-2")}>
                {onOpen ? (
                    <button
                        type="button"
                        onClick={onOpen}
                        title={name}
                        className="block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        {name}
                    </button>
                ) : (
                    <div className="truncate font-medium" title={name}>{name}</div>
                )}
                <div className="truncate text-xs text-muted-foreground">{kind}</div>
            </div>
        </div>
    );
}

interface StatusCellProps {
    status: ConnectionHealth;
    configId: string;
    lastCheckedAt?: string | null;
    /** Shown after the label, such as the response time. */
    detail?: string | null;
    error?: string | null;
    /** Opens the check history, which needs the read permission of the connection's kind. */
    interactive: boolean;
}

/** The live health status. A click shows the latest checks. */
export function StatusCell({ status, configId, lastCheckedAt, detail, error, interactive }: StatusCellProps) {
    const [open, setOpen] = useState(false);
    const style = HEALTH[status];
    const label = (
        <>
            <span className={cn("size-2 shrink-0 rounded-full", style.dot)} aria-hidden="true" />
            <span className={cn("text-sm", style.text)}>{style.label}</span>
            {detail && <span className="text-xs text-muted-foreground tabular-nums">{detail}</span>}
        </>
    );

    if (!interactive) return <span className="inline-flex items-center gap-2">{label}</span>;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="-mx-1.5 inline-flex items-center gap-2 rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    {label}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-85 p-0" align="start">
                <div className="space-y-1.5 border-b p-4">
                    <div className="flex items-center gap-2">
                        <span className={cn("size-2.5 rounded-full", style.dot)} aria-hidden="true" />
                        <h4 className="font-semibold leading-none">{style.label}</h4>
                    </div>
                    {lastCheckedAt && (
                        <p className="text-xs text-muted-foreground">
                            Last checked <DateDisplay date={lastCheckedAt} format="Pp" />
                        </p>
                    )}
                    {error && status !== "ONLINE" && <p className="text-xs wrap-anywhere text-muted-foreground">{error}</p>}
                </div>
                <div className="p-4">{open && <HealthHistoryGrid adapterId={configId} />}</div>
            </PopoverContent>
        </Popover>
    );
}

/** One bar per hour of the last day, and the share of checks that passed. */
export function HealthBars({ buckets, passed }: { buckets: HealthBucket[]; passed: number | null }) {
    if (passed === null) return <Muted>-</Muted>;
    return (
        <div className="flex items-center gap-2">
            <div className="flex h-3.5 items-stretch gap-px" aria-hidden="true">
                {buckets.map((bucket, hour) => (
                    <span key={hour} className={cn("w-0.75 rounded-xs", BUCKETS[bucket])} />
                ))}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
                {Number.isInteger(passed) ? passed : passed.toFixed(1)}%
                <span className="sr-only"> of the health checks in the last 24 hours passed</span>
            </span>
        </div>
    );
}

/** When something last ran, with a dot for how it went. */
export function LastRunCell({ run, never }: { run: { at: string; status: string } | null | undefined; never: string }) {
    if (!run) return <Muted>{run === null ? never : "-"}</Muted>;
    return (
        <span className="inline-flex items-center gap-2 text-sm">
            <span className={cn("size-1.5 shrink-0 rounded-full", RUNS[run.status] ?? "bg-muted-foreground")} aria-hidden="true" />
            <RelativeTime date={run.at} />
            <span className="sr-only">, {run.status}</span>
        </span>
    );
}

export function UsedByCell({ usedBy }: { usedBy: { jobs: number; templates: number } | undefined }) {
    if (!usedBy) return <Muted>-</Muted>;
    const parts = [
        usedBy.jobs > 0 ? `${usedBy.jobs} job${usedBy.jobs === 1 ? "" : "s"}` : null,
        usedBy.templates > 0 ? `${usedBy.templates} template${usedBy.templates === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? <span className="text-sm tabular-nums">{parts.join(", ")}</span> : <Muted>Not used</Muted>;
}

export function CredentialCell({ name }: { name: string | null | undefined }) {
    if (!name) return <Muted>-</Muted>;
    return (
        <span className="inline-flex min-w-0 max-w-48 items-center gap-1.5 text-sm" title={name}>
            <KeyRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{name}</span>
        </span>
    );
}
