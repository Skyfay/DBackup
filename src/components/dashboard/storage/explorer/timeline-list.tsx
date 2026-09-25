"use client";

import { useMemo, useState } from "react";
import type { BackupRun, ExplorerDestination, ExplorerJob, ExplorerPlan } from "@/services/storage/explorer-types";
import { PickChip } from "./explorer-controls";
import { JobsTimeline } from "./jobs-timeline";
import { useTimelineFormat } from "./timeline-cells";
import { pickedRuns, type TimelinePick } from "./timeline-model";

interface TimelineListInput {
    /** Whether the list shows as the timeline. */
    on: boolean;
    /** The backups the filters leave. */
    runs: BackupRun[];
    /** Every job of the index, in its order. */
    jobs: ExplorerJob[];
    jobsByKey: Map<string, ExplorerJob>;
    /** The jobs of the Job filter, none for every job. */
    scopeJobs: string[];
    /** Whether a filter other than the job narrows the backups, which leaves out the rows without any. */
    narrowed: boolean;
    plan: ExplorerPlan | null;
    destinations: Map<string, ExplorerDestination>;
    at: string[];
}

export interface TimelineList {
    /** The rows the list shows: every backup without the timeline, what it picked with it. */
    data: BackupRun[];
    /** The timeline, between the toolbar of the list and its rows. */
    above?: React.ReactNode;
    /** The list waits for a pick on the timeline. */
    hideRows: boolean;
    /** What the timeline picked, as a chip in the toolbar that removes it. */
    chip?: React.ReactNode;
}

/**
 * The list of backups as the timeline view shows it: the timeline between the filters and the
 * rows, and the rows only once a day, a job or a day of a job is picked on it.
 */
export function useTimelineList({ on, runs, jobs, jobsByKey, scopeJobs, narrowed, plan, destinations, at }: TimelineListInput): TimelineList {
    const format = useTimelineFormat();
    const [pick, setPick] = useState<TimelinePick | null>(null);

    // A row for every job with backups the filters leave, and for every existing job while no
    // other filter narrows them, so a job that has not run yet still shows its plan.
    const rowJobs = useMemo(() => {
        const withRuns = new Set(runs.map((run) => run.jobKey));
        return jobs.filter((job) => (scopeJobs.length === 0 || scopeJobs.includes(job.key)) && (withRuns.has(job.key) || (!narrowed && job.kind === "job")));
    }, [runs, jobs, scopeJobs, narrowed]);
    const picked = useMemo(() => (on && pick ? pickedRuns(runs, pick, format.dayOf) : []), [on, pick, runs, format]);

    if (!on) return { data: runs, hideRows: false };

    const job = pick?.jobKey ? jobsByKey.get(pick.jobKey) : undefined;
    const when = pick ? (pick.from === pick.to ? format.date(pick.from) : `${format.short(pick.from)} - ${format.short(pick.to)}`) : "";
    return {
        data: picked,
        hideRows: pick === null,
        above: <JobsTimeline runs={runs} jobs={rowJobs} plan={plan} destinations={destinations} at={at} pick={pick} onPick={setPick} />,
        chip: pick ? <PickChip label={job ? `${job.name} · ${when}` : when} count={picked.length} onClear={() => setPick(null)} /> : undefined,
    };
}
