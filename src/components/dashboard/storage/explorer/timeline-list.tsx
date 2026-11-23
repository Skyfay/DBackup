"use client";

import { useMemo, useState } from "react";
import type { ExplorerDestination, ExplorerJob, ExplorerPlan } from "@/services/storage/explorer-types";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import { PickChip } from "./explorer-controls";
import { JobsTimeline } from "./jobs-timeline";
import { sharedJobKey, type ListRun, type QuickPick } from "./shared-runs";
import { useTimelineFormat } from "./timeline-cells";
import { pickedRuns, type TimelinePick } from "./timeline-model";
import { sharedLineDatabases } from "./timeline-shared";

interface TimelineListInput {
    /** Whether the list shows as the timeline. */
    on: boolean;
    /** The backups the filters leave. */
    runs: ListRun[];
    /** Every job of the index, in its order. */
    jobs: ExplorerJob[];
    jobsByKey: Map<string, ExplorerJob>;
    /** Every database another tenant's server gives to this one, none without. */
    sharedDatabases?: SharedDatabase[];
    /** The jobs of the Job filter, none for every job. */
    scopeJobs: string[];
    /** Whether a filter other than the job narrows the backups, which leaves out the rows without any. */
    narrowed: boolean;
    /** The quick filter, which leaves out the rows of the own jobs or of the shared databases. */
    quick?: QuickPick;
    plan: ExplorerPlan | null;
    destinations: Map<string, ExplorerDestination>;
    at: string[];
    /** Opens a backup in its details, `onClosed` runs once they are gone again. */
    onOpen: (run: ListRun, onClosed?: () => void) => void;
    /** Moves to the list view, for Show in the list. */
    onShowList: () => void;
}

export interface TimelineList {
    /** The rows the list shows: every backup, or what the timeline handed it. None under the timeline. */
    data: ListRun[];
    /** The timeline, between the toolbar of the list and its rows. */
    above?: React.ReactNode;
    /** The timeline lists what a click picks where the click was, so no rows show under it. */
    hideRows: boolean;
    /** What the timeline handed to the list, as a chip in the toolbar that removes it. */
    chip?: React.ReactNode;
}

/**
 * The list of backups with the timeline: the timeline between the filters and the rows in its view,
 * which lists the backups of a click where it was. Show in the list moves what such a list holds to
 * the list view, as a chip of its toolbar, which a move back to the timeline drops.
 */
export function useTimelineList({ on, runs, jobs, jobsByKey, sharedDatabases = [], scopeJobs, narrowed, quick = "all", plan, destinations, at, onOpen, onShowList }: TimelineListInput): TimelineList {
    const format = useTimelineFormat();
    const [pick, setPick] = useState<TimelinePick | null>(null);
    const [wasOn, setWasOn] = useState(on);
    if (wasOn !== on) {
        setWasOn(on);
        if (on) setPick(null);
    }

    // A row for every job with backups the filters leave, and for every existing job while no
    // other filter narrows them, so a job that has not run yet still shows its plan.
    const rowJobs = useMemo(() => {
        if (quick === "shared") return [];
        const withRuns = new Set(runs.map((run) => run.jobKey));
        return jobs.filter((job) => (scopeJobs.length === 0 || scopeJobs.includes(job.key)) && (withRuns.has(job.key) || (!narrowed && job.kind === "job")));
    }, [runs, jobs, scopeJobs, narrowed, quick]);
    // The shared databases follow the jobs by the same rules.
    const rowShared = useMemo(
        () => sharedLineDatabases({ databases: sharedDatabases, runs, scopeJobs, narrowed, quick }),
        [sharedDatabases, runs, scopeJobs, narrowed, quick]
    );
    const picked = useMemo(() => (!on && pick ? pickedRuns(runs, pick, format.dayOf) : runs), [on, pick, runs, format]);

    if (on) {
        return {
            data: [],
            hideRows: true,
            above: (
                <JobsTimeline
                    runs={runs}
                    jobs={rowJobs}
                    shared={rowShared}
                    plan={plan}
                    destinations={destinations}
                    at={at}
                    onOpen={onOpen}
                    onShowInList={(next) => {
                        setPick(next);
                        onShowList();
                    }}
                />
            ),
        };
    }
    if (!pick) return { data: runs, hideRows: false };

    const name = pick.jobKey ? jobsByKey.get(pick.jobKey)?.name ?? sharedDatabases.find((database) => sharedJobKey(database) === pick.jobKey)?.databaseName : undefined;
    const when = pick.from === pick.to ? format.date(pick.from) : `${format.short(pick.from)} - ${format.short(pick.to)}`;
    return {
        data: picked,
        hideRows: false,
        chip: <PickChip label={name ? `${name} · ${when}` : when} count={picked.length} onClear={() => setPick(null)} />,
    };
}
