"use client";

import { CircleX, Clock, ClockAlert, FolderOpen, KeyRound, Layers, Lock, MousePointerClick, Settings2, ShieldCheck, Unlink } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatBytes } from "@/lib/utils";
import type { CopyState, ExplorerDestination, ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";
import { isIncremental, madeAt, snapshotBytes, startedBy, typeLabel } from "./explorer-format";

const TILE = "flex shrink-0 items-center justify-center rounded-lg border bg-muted/50";

/** The logo of what a job backs up: its database, its folders, or what stands in for a job. */
export function JobIcon({ job, className }: { job: Pick<ExplorerJob, "kind" | "sourceType" | "hasFolders">; className?: string }) {
    if (job.kind === "system") return <Settings2 className={cn("text-muted-foreground", className)} />;
    if (job.kind === "none") return <Unlink className={cn("text-muted-foreground", className)} />;
    if (job.sourceType) return <AdapterIcon adapterId={job.sourceType} className={className} />;
    return <FolderOpen className={cn("text-muted-foreground", className)} />;
}

export function JobTile({ job, size = "md" }: { job: Pick<ExplorerJob, "kind" | "sourceType" | "hasFolders">; size?: "sm" | "md" | "lg" }) {
    const box = size === "lg" ? "size-10" : size === "md" ? "size-8" : "size-7";
    const icon = size === "lg" ? "size-5" : "size-4";
    return (
        <span className={cn(TILE, box)} aria-hidden="true">
            <JobIcon job={job} className={icon} />
        </span>
    );
}

export function DestinationTile({ destination, size = "md" }: { destination: Pick<ExplorerDestination, "adapterId">; size?: "sm" | "md" | "lg" }) {
    const box = size === "lg" ? "size-10" : size === "md" ? "size-8" : "size-7";
    const icon = size === "lg" ? "size-5" : "size-4";
    return (
        <span className={cn(TILE, box)} aria-hidden="true">
            <AdapterIcon adapterId={destination.adapterId} className={icon} />
        </span>
    );
}

/** Whether a destination's listing may be behind: it did not answer its last check, or could not be listed. */
export function isStale(destination: Pick<ExplorerDestination, "health" | "listError">): boolean {
    return destination.health.status === "OFFLINE" || destination.listError !== null;
}

interface CopyChipProps {
    destination: ExplorerDestination | undefined;
    state: CopyState;
}

/** One destination a backup lies at, or should: a quiet chip, dashed amber when the copy is missing. */
export function CopyChip({ destination, state }: CopyChipProps) {
    const name = destination?.name ?? "Removed destination";
    if (state === "missing") {
        return (
            <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-dashed border-warning/60 px-2 text-xs font-medium whitespace-nowrap text-warning">
                {destination && <AdapterIcon adapterId={destination.adapterId} className="size-3.5" />}
                {name} missing
            </span>
        );
    }
    const stale = destination ? isStale(destination) : false;
    const chip = (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium whitespace-nowrap">
            {destination && <AdapterIcon adapterId={destination.adapterId} className="size-3.5" />}
            {name}
            {stale && <ClockAlert className="size-3.5 text-warning" aria-label="Not compared with the storage lately" />}
        </span>
    );
    if (!stale || !destination) return chip;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{chip}</TooltipTrigger>
            <TooltipContent className="max-w-xs">
                {destination.listedAt ? (
                    <>
                        {destination.name} did not answer, so this is its list of <DateDisplay date={destination.listedAt} format="Pp" />.
                    </>
                ) : (
                    `${destination.name} could not be listed.`
                )}
            </TooltipContent>
        </Tooltip>
    );
}

/** Every destination of a backup, in the upload order of its job. */
export function CopyChips({ copies, destinations, empty = "Only here" }: {
    copies: { destinationId: string; state: CopyState }[];
    destinations: Map<string, ExplorerDestination>;
    empty?: string;
}) {
    if (copies.length === 0) return <span className="text-sm text-muted-foreground">{empty}</span>;
    return (
        <span className="flex flex-wrap gap-1.5">
            {copies.map((copy) => (
                <CopyChip key={copy.destinationId} destination={destinations.get(copy.destinationId)} state={copy.state} />
            ))}
        </span>
    );
}

/** The last integrity check of a backup. */
export function IntegrityBadge({ verification }: { verification: ExplorerFile["verification"] }) {
    if (!verification) return <span className="text-xs text-muted-foreground">Not checked</span>;
    if (!verification.passed) {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-destructive">
                <CircleX className="size-3.5" aria-hidden="true" />
                Check failed
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
            <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
            Verified
        </span>
    );
}

const STARTED_BY_ICONS = { schedule: Clock, api: KeyRound, manual: MousePointerClick };

export function StartedBy({ file }: { file: Pick<ExplorerFile, "trigger"> }) {
    const started = startedBy(file);
    if (!started) return <span className="text-sm text-muted-foreground">-</span>;
    const Icon = STARTED_BY_ICONS[started.kind];
    return (
        <span className="inline-flex min-w-0 items-center gap-2 text-sm">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{started.label}</span>
        </span>
    );
}

export function TypeChip({ file }: { file: Pick<ExplorerFile, "backupType" | "chain"> }) {
    return (
        <span className="inline-flex h-5 items-center gap-1 rounded-md bg-muted px-1.5 text-[11px] font-medium whitespace-nowrap">
            {isIncremental(file) && <Layers className="size-3 text-muted-foreground" aria-hidden="true" />}
            {typeLabel(file)}
        </span>
    );
}

/** Locked and encrypted, as two small icons. */
export function BackupFlags({ file }: { file: Pick<ExplorerFile, "locked" | "isEncrypted"> }) {
    return (
        <span className="flex items-center gap-2">
            {file.locked && (
                <Lock className="size-3.5 text-warning" aria-label="Locked, retention leaves it alone" />
            )}
            {file.isEncrypted && <KeyRound className="size-3.5 text-muted-foreground" aria-label="Encrypted" />}
        </span>
    );
}

/** The snapshot size of a backup, with what the archive stores under it for an incremental. */
export function SizeCell({ file }: { file: Pick<ExplorerFile, "size" | "logicalSize"> }) {
    const snapshot = snapshotBytes(file);
    return (
        <div className="text-right tabular-nums">
            <div className="text-sm font-medium">{formatBytes(snapshot)}</div>
            {snapshot > file.size && <div className="text-xs text-muted-foreground">{formatBytes(file.size)} stored</div>}
        </div>
    );
}

/** When a backup was made, and how long ago. */
export function MadeAt({ file, sub }: { file: Pick<ExplorerFile, "createdAt" | "lastModified">; sub?: React.ReactNode }) {
    const date = madeAt(file);
    return (
        <div className="min-w-0">
            <div className="truncate text-sm font-medium">
                <DateDisplay date={date} format="Pp" />
            </div>
            <div className="truncate text-xs text-muted-foreground">
                <RelativeTime date={date} />
                {sub && <> · {sub}</>}
            </div>
        </div>
    );
}
