"use client";

import { Clock, KeyRound, Lock, MousePointerClick, Unlink, Unplug } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import type { BackupRun, ExplorerDestination, ExplorerJob, ExplorerJobKind } from "@/services/storage/explorer-types";
import type { BackupCounts, BackupState, StartedByOption } from "./backup-filters";
import { JobIcon } from "./explorer-cells";
import { count } from "./explorer-format";

const GROUPS: Record<ExplorerJobKind, string> = { job: "Jobs", deleted: "Deleted jobs", system: "Not from a job", none: "Not from a job" };
const STARTER_ICONS: Record<StartedByOption["group"], React.ComponentType<{ className?: string }> | null> = {
    "": Clock,
    "By hand": MousePointerClick,
    "API keys": KeyRound,
    Other: null,
};
const UNAVAILABLE = "No backups with the other filters";

function StateDot({ className }: { className: string }) {
    return (
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
            <span className={cn("size-2 rounded-full", className)} />
        </span>
    );
}

const STATES: { value: BackupState; label: string; lead: React.ReactNode }[] = [
    { value: "missing", label: "A copy is missing", lead: <StateDot className="bg-warning" /> },
    { value: "failed", label: "The check failed", lead: <StateDot className="bg-destructive" /> },
    { value: "unreachable", label: "No copy answers right now", lead: <Unplug className="size-4 shrink-0 text-destructive" /> },
    { value: "locked", label: "Locked", lead: <Lock className="size-4 shrink-0 text-muted-foreground" /> },
    { value: "deleted", label: "Of a deleted job", lead: <Unlink className="size-4 shrink-0 text-muted-foreground" /> },
];

/** How many backups need a look, in the closed State filter: amber with a copy missing, red with a failed check or no copy that answers. */
function NeedsLook({ warning, destructive }: BackupCounts["attention"]) {
    if (warning === 0 && destructive === 0) return null;
    return (
        <span className="flex items-center gap-2 text-xs font-semibold tabular-nums">
            {warning > 0 && (
                <span className="flex items-center gap-1 text-warning">
                    <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                    {warning}
                    <span className="sr-only"> with a copy missing,</span>
                </span>
            )}
            {destructive > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                    <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
                    {destructive}
                    <span className="sr-only"> with a failed check or no copy that answers</span>
                </span>
            )}
        </span>
    );
}

interface FilterColumnsInput {
    /** Every job of the index, in its order: jobs, deleted jobs, then the rest. */
    jobs: ExplorerJob[];
    destinations: ExplorerDestination[];
    starters: StartedByOption[];
    counts: BackupCounts;
    /** How many backups the filters leave, for the foot of each. */
    shown: number;
}

/**
 * The filters of the list of every backup: job, destination, who started it and state. State holds
 * what used to be quick filters beside the search, so the toolbar keeps to one row, and while
 * nothing is picked it counts what needs a look.
 */
export function backupFilterColumns({ jobs, destinations, starters, counts, shown }: FilterColumnsInput): DataTableFilterableColumn<BackupRun>[] {
    const shared = { note: "The numbers count the backups", resultLabel: count(shown, "backup"), unavailableLabel: UNAVAILABLE };
    return [
        {
            id: "job",
            title: "Job",
            ...shared,
            options: jobs.map((job) => ({
                value: job.key,
                label: job.name,
                group: GROUPS[job.kind],
                lead: <JobIcon job={job} className="size-4 shrink-0" />,
                count: counts.jobs.get(job.key) ?? 0,
            })),
        },
        {
            id: "at",
            title: "Destination",
            ...shared,
            options: destinations.map((destination) => ({
                value: destination.id,
                label: destination.name,
                lead: <AdapterIcon adapterId={destination.adapterId} className="size-4 shrink-0" />,
                count: counts.at.get(destination.id) ?? 0,
            })),
        },
        {
            id: "startedBy",
            title: "Started by",
            heading: "Filter by who started it",
            ...shared,
            options: starters.map((starter) => {
                const Icon = STARTER_ICONS[starter.group];
                return {
                    value: starter.value,
                    label: starter.label,
                    group: starter.group,
                    lead: Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : undefined,
                    count: counts.by.get(starter.value) ?? 0,
                };
            }),
        },
        {
            id: "state",
            title: "State",
            ...shared,
            note: "Counted under the other filters",
            hint: <NeedsLook {...counts.attention} />,
            options: STATES.map((state) => ({ ...state, count: counts.states[state.value] })),
        },
    ];
}
