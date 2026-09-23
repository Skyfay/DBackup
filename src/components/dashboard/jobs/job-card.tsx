"use client";

import { Archive, ChevronRight, CircleAlert, Lock, LockOpen, Repeat, TriangleAlert, type LucideIcon } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { ExecutionStatusBadge } from "@/components/dashboard/widgets/execution-status";
import { RunBars } from "@/components/dashboard/widgets/run-bars";
import { isPlainClick } from "@/components/ui/row-click";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { cn } from "@/lib/utils";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { NextRun, RunLine, ScheduleText, SourceIcon, sourceOf } from "./job-cells";

const COMPRESSION: Record<string, string> = { GZIP: "Gzip", BROTLI: "Brotli" };
/** Destinations a card names, the rest are counted. */
const DESTINATIONS_SHOWN = 2;

const typeName = (adapterId: string) => getAdapterDefinition(adapterId)?.name ?? adapterId;

function Node({ icon, name, detail }: { icon: React.ReactNode; name: string; detail: string }) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50">{icon}</span>
            <div className="min-w-0">
                <div className="truncate text-sm font-medium" title={name}>{name}</div>
                <div className="truncate text-xs text-muted-foreground" title={detail}>{detail}</div>
            </div>
        </div>
    );
}

function Chip({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
    return (
        <span className="inline-flex max-w-32 items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs font-medium">
            <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{children}</span>
        </span>
    );
}

const Arrow = () => <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />;

/** The way of a backup: where it comes from, what happens on the way and where it goes. */
function Flow({ job }: { job: JobListItem }) {
    const source = sourceOf(job);
    const firstFolder = job.sources[0];
    const sourceDetail = job.source ? typeName(job.source.adapterId) : firstFolder ? firstFolder.path : "";
    const compression = COMPRESSION[job.compression];
    const shown = job.destinations.slice(0, DESTINATIONS_SHOWN);
    const more = job.destinations.length - shown.length;

    return (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto_minmax(0,1fr)] items-center gap-2">
            <Node icon={<SourceIcon adapterId={source.adapterId} className="size-4" />} name={`${source.name}${source.more > 0 ? ` +${source.more}` : ""}`} detail={sourceDetail} />
            <Arrow />
            <div className="flex flex-col items-start gap-1">
                <Chip icon={job.encryptionProfile ? Lock : LockOpen}>{job.encryptionProfile?.name ?? "Not encrypted"}</Chip>
                {compression && <Chip icon={Archive}>{compression}</Chip>}
                {job.backupMode === "INCREMENTAL" && <Chip icon={Repeat}>Incremental</Chip>}
            </div>
            <Arrow />
            <div className="grid min-w-0 gap-1.5">
                {shown.map((destination) => (
                    <Node
                        key={destination.configId}
                        icon={<AdapterIcon adapterId={destination.config.adapterId} className="size-4" />}
                        name={destination.config.name}
                        detail={typeName(destination.config.adapterId)}
                    />
                ))}
                {more > 0 && <span className="pl-10 text-xs text-muted-foreground">+{more} more</span>}
                {shown.length === 0 && <span className="text-sm text-muted-foreground">No destination</span>}
            </div>
        </div>
    );
}

/** A run going on right now, or what went wrong in the last one. */
function Notice({ job }: { job: JobListItem }) {
    const { live, error, status } = job.overview;
    if (live) {
        return (
            <div>
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                    <span>{live.status === "Pending" ? "Waiting for its turn" : live.stage ?? "Starting"}</span>
                    {live.progress !== null && <span>{live.progress}%</span>}
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-info transition-[width]" style={{ width: `${live.progress ?? 0}%` }} />
                </div>
            </div>
        );
    }
    if (!error) return null;
    const failed = status === "Failed";
    const Icon = failed ? CircleAlert : TriangleAlert;
    return (
        <div
            className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                failed ? "border-destructive/25 bg-destructive/5 text-destructive" : "border-warning/25 bg-warning/5 text-warning"
            )}
        >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title={error}>{error}</span>
        </div>
    );
}

interface JobCardProps {
    job: JobListItem;
    onOpen: (job: JobListItem) => void;
    /** Run now and the menu, the same as at the end of a table row. */
    actions: React.ReactNode;
}

/**
 * One job as a card, the second view of the Jobs page and the one a phone always gets. It shows
 * the way of the backup instead of the table's columns: source, what happens on the way and the
 * destinations, then how the last runs went and when the next one starts.
 */
export function JobCard({ job, onOpen, actions }: JobCardProps) {
    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen(job)}
            className="flex min-w-0 cursor-pointer flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20 group-data-[state=open]/row:border-foreground/20"
        >
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => onOpen(job)}
                        className={cn(
                            "block max-w-full truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50",
                            !job.enabled && "text-muted-foreground"
                        )}
                    >
                        {job.name}
                    </button>
                    <ScheduleText job={job} className="block" />
                </div>
                <ExecutionStatusBadge status={job.enabled || job.overview.live ? job.overview.status : null} label={!job.enabled && !job.overview.live ? "Paused" : job.overview.status ? undefined : "Never ran"} />
            </div>

            <Flow job={job} />
            <Notice job={job} />

            <div className="mt-auto flex min-w-0 items-center gap-3 border-t pt-3">
                <RunBars runs={job.overview.runs} className="shrink-0" />
                {/* The error already has its own line above, so the footer keeps to when it ran. */}
                <div className="min-w-0 flex-1">{!job.overview.error && !job.overview.live && <RunLine job={job} />}</div>
                <span className="shrink-0 text-xs tabular-nums">
                    {job.enabled && <span className="text-muted-foreground">Next </span>}
                    <NextRun job={job} />
                </span>
                <div className="-mr-2 shrink-0">{actions}</div>
            </div>
        </div>
    );
}
