"use client";

import { ListCap } from "@/components/ui/list-cap";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { JobsTimeline } from "./jobs-timeline";
import { JobsUpcoming } from "./jobs-upcoming";
import type { JobTimelineState } from "./use-job-timeline";

interface JobsTimelineViewsProps {
    view: "timeline" | "upcoming";
    /** The jobs the server sent for the views, the first ones the search and the filters leave. */
    jobs: JobListItem[];
    /** How many jobs the search and the filters leave, more than `jobs` holds on a big instance. */
    total: number;
    timeline: JobTimelineState;
    canViewHistory: boolean;
    onOpenJob: (job: JobListItem) => void;
}

/** The Timeline or Upcoming view of the Jobs page, with a line when it draws only the first jobs of many. */
export function JobsTimelineViews({ view, jobs, total, timeline, canViewHistory, onOpenJob }: JobsTimelineViewsProps) {
    return (
        <>
            <ListCap shown={jobs.length} total={total} noun="jobs" />
            {view === "timeline"
                ? <JobsTimeline jobs={jobs} allJobs={jobs} timeline={timeline} canViewHistory={canViewHistory} onOpenJob={onOpenJob} />
                : <JobsUpcoming jobs={jobs} allJobs={jobs} timeline={timeline} onOpenJob={onOpenJob} />}
        </>
    );
}
