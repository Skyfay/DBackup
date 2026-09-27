"use client";

import Link from "next/link";
import { Archive, Clock, KeyRound, MousePointerClick, RotateCcw, ShieldCheck, UserRound } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { ExecutionStatusBadge } from "@/components/dashboard/widgets/execution-status";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatBytes } from "@/lib/utils";
import type { RunRow, RunStarter } from "@/services/history/run-types";
import { tookOf, usualText } from "./run-format";

const TILE = "flex shrink-0 items-center justify-center rounded-lg border bg-muted/50";

const TASK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    IntegrityCheck: ShieldCheck,
    Verification: ShieldCheck,
    "System Restore": Archive,
    Restore: RotateCcw,
};

/** The logo of the source of a run, or the icon of a system task. */
export function RunTile({ row, size = "md" }: { row: Pick<RunRow, "adapterId" | "type">; size?: "md" | "lg" }) {
    const box = size === "lg" ? "size-11" : "size-8";
    const icon = size === "lg" ? "size-5" : "size-4";
    const Icon = TASK_ICONS[row.type];
    return (
        <span className={cn(TILE, box)} aria-hidden="true">
            {row.adapterId ? <AdapterIcon adapterId={row.adapterId} className={icon} /> : Icon ? <Icon className={cn(icon, "text-muted-foreground")} /> : <Archive className={cn(icon, "text-muted-foreground")} />}
        </span>
    );
}

export function RunName({ row, href }: { row: RunRow; href: string }) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <RunTile row={row} />
            <div className="min-w-0">
                {/* The keyboard way in, a click anywhere on the row opens it too. */}
                <Link href={href} className="block truncate rounded-sm font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50">
                    {row.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">{row.sub}</p>
            </div>
        </div>
    );
}

/** A thin bar for the progress of a live run, in the running color. */
export function LiveBar({ percent, className }: { percent: number | null; className?: string }) {
    return (
        <span className={cn("block h-1 overflow-hidden rounded-full bg-info/15", className)} aria-hidden="true">
            <span className={cn("block h-full rounded-full bg-info", percent === null && "w-1/3 animate-pulse")} style={percent === null ? undefined : { width: `${Math.max(percent, 2)}%` }} />
        </span>
    );
}

export function RunStatusCell({ row }: { row: RunRow }) {
    const tone = row.status === "Failed" ? "text-destructive" : row.status === "Partial" ? "text-warning" : "text-muted-foreground";
    return (
        <div className="min-w-0">
            <ExecutionStatusBadge status={row.status} />
            {row.status === "Running" ? (
                <div className="mt-1.5 flex items-center gap-2">
                    <LiveBar percent={row.live?.percent ?? null} className="w-24" />
                    <span className="truncate text-xs text-muted-foreground">{row.note}</span>
                </div>
            ) : (
                row.note && <p className={cn("mt-1 truncate text-xs", tone)} title={row.note}>{row.note}</p>
            )}
        </div>
    );
}

export function StartedCell({ startedAt }: { startedAt: string }) {
    return (
        <div className="min-w-0 text-sm">
            <p className="truncate tabular-nums"><DateDisplay date={startedAt} format="Pp" /></p>
            <RelativeTime date={startedAt} className="block truncate text-xs text-muted-foreground" />
        </div>
    );
}

export function TookCell({ row, now }: { row: RunRow; now: number }) {
    const usual = usualText(row.usualMs);
    return (
        <div className="min-w-0 text-sm">
            <p className="tabular-nums">{tookOf(row, now)}</p>
            {usual && <p className="truncate text-xs text-muted-foreground">{usual}</p>}
        </div>
    );
}

export function SizeCell({ row }: { row: RunRow }) {
    const copies = row.copies;
    const copiesText = copies ? `${copies.stored} of ${copies.total} ${copies.total === 1 ? "copy" : "copies"}` : null;
    return (
        <div className="min-w-0 text-sm">
            <p className="tabular-nums">{row.size !== null && row.size > 0 ? formatBytes(row.size) : "-"}</p>
            {copiesText && <p className={cn("truncate text-xs", copies && copies.failed.length > 0 ? "text-warning" : "text-muted-foreground")}>{copiesText}</p>}
        </div>
    );
}

const STARTER_ICONS: Record<RunStarter["kind"], React.ComponentType<{ className?: string }>> = {
    schedule: Clock,
    manual: UserRound,
    api: KeyRound,
    none: MousePointerClick,
};

export function StarterCell({ starter }: { starter: RunStarter }) {
    const Icon = STARTER_ICONS[starter.kind];
    return (
        <span className="flex min-w-0 items-center gap-2 text-sm">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{starter.label}</span>
        </span>
    );
}
