"use client";

import { CalendarClock, CircleCheck, Clock, LoaderCircle, TriangleAlert } from "lucide-react";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { namesFor } from "@/lib/core/tab-attention";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { lastOutcome } from "./job-status";

const DONE = new Set(["Success", "Failed", "Partial"]);

/**
 * The numbers above the jobs: how many run on their schedule, how their latest runs went, which
 * need attention, which runs next and what runs right now. Worked out from the list itself.
 */
export function JobsStrip({ jobs }: { jobs: JobListItem[] }) {
    const paused = jobs.filter((job) => !job.enabled).length;
    const runs = jobs.flatMap((job) => job.overview.runs).filter((run) => DONE.has(run.status));
    const succeeded = runs.filter((run) => run.status === "Success").length;
    const share = runs.length > 0 ? Math.round((succeeded / runs.length) * 1000) / 10 : null;
    const failed = jobs.filter((job) => lastOutcome(job) === "Failed").map((job) => job.name);
    const partial = jobs.filter((job) => lastOutcome(job) === "Partial").map((job) => job.name);
    const attention = [
        ...(failed.length > 0 ? [`${namesFor(failed)} failed`] : []),
        ...(partial.length > 0 ? [`${namesFor(partial)} missed a copy`] : []),
    ];
    const next = jobs
        .filter((job) => job.overview.nextRunAt)
        .sort((a, b) => Date.parse(a.overview.nextRunAt!) - Date.parse(b.overview.nextRunAt!))[0];
    const running = jobs.filter((job) => job.overview.live?.status === "Running");
    const waiting = jobs.filter((job) => job.overview.live?.status === "Pending").length;

    return (
        <ExplorerStrip joined
            cells={[
                {
                    label: "Jobs",
                    icon: CalendarClock,
                    value: jobs.length.toLocaleString(),
                    extra: paused > 0 ? `${(jobs.length - paused).toLocaleString()} on their schedule, ${paused.toLocaleString()} paused` : "all on their schedule",
                },
                {
                    label: "Succeeded",
                    icon: CircleCheck,
                    value: share !== null ? share.toLocaleString() : "-",
                    unit: share !== null ? "%" : undefined,
                    // Green only while nothing of it failed, a red tile next to it says the rest.
                    tone: share === 100 ? "success" : undefined,
                    extra: runs.length > 0 ? `${succeeded.toLocaleString()} of the latest ${runs.length.toLocaleString()} runs` : "no run yet",
                },
                {
                    label: "Needs attention",
                    icon: TriangleAlert,
                    value: (failed.length + partial.length).toLocaleString(),
                    tone: failed.length > 0 ? "destructive" : partial.length > 0 ? "warning" : undefined,
                    extra: attention.length > 0 ? attention.join(", ") : "every last run went through",
                },
                {
                    label: "Next run",
                    icon: Clock,
                    value: next ? <RelativeTime date={next.overview.nextRunAt!} /> : "-",
                    extra: next ? next.name : "no job runs on a schedule",
                },
                {
                    label: "Running",
                    icon: LoaderCircle,
                    value: running.length.toLocaleString(),
                    extra: running.length > 0
                        ? running.map((job) => [job.name, job.overview.live?.progress != null ? `${job.overview.live.progress} %` : null].filter(Boolean).join(" ")).join(", ")
                        : waiting > 0 ? `${waiting.toLocaleString()} waiting for a slot` : "nothing runs right now",
                },
            ]}
        />
    );
}
