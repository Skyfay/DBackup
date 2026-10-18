"use client";

import { CalendarClock, CircleCheck, Clock, LoaderCircle, TriangleAlert } from "lucide-react";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { successShare } from "@/lib/core/success-share";
import { namesFor } from "@/lib/core/tab-attention";
import type { JobStats } from "@/services/jobs/job-page-types";

/**
 * The numbers above the jobs: how many run on their schedule, how their latest runs went, which
 * need attention, which runs next and what runs right now. Of every job, whatever the search and
 * the filters, counted by the server, which pages the list.
 */
export function JobsStrip({ stats }: { stats: JobStats }) {
    const { total, paused, failed, partial, next, running, waiting } = stats;
    const { succeeded } = stats.runs;
    const finished = stats.runs.succeeded + stats.runs.partial + stats.runs.failed;
    const share = successShare(stats.runs);
    const attention = [
        ...(failed.count > 0 ? [`${namesFor(failed.names, failed.count)} failed`] : []),
        ...(partial.count > 0 ? [`${namesFor(partial.names, partial.count)} missed a copy`] : []),
    ];
    const runningNames = running.jobs.map((job) => [job.name, job.progress != null ? `${job.progress} %` : null].filter(Boolean).join(" "));
    const moreRunning = running.count - running.jobs.length;

    return (
        <ExplorerStrip joined
            cells={[
                {
                    label: "Jobs",
                    icon: CalendarClock,
                    value: total.toLocaleString(),
                    extra: paused > 0 ? `${(total - paused).toLocaleString()} on their schedule, ${paused.toLocaleString()} paused` : "all on their schedule",
                },
                {
                    label: "Succeeded",
                    icon: CircleCheck,
                    value: share !== null ? share.toLocaleString() : "-",
                    unit: share !== null ? "%" : undefined,
                    // Green only while nothing of it failed, a red tile next to it says the rest.
                    tone: share === 100 ? "success" : undefined,
                    extra: finished > 0 ? `${succeeded.toLocaleString()} of the latest ${finished.toLocaleString()} runs` : "no run yet",
                },
                {
                    label: "Needs attention",
                    icon: TriangleAlert,
                    value: (failed.count + partial.count).toLocaleString(),
                    tone: failed.count > 0 ? "destructive" : partial.count > 0 ? "warning" : undefined,
                    extra: attention.length > 0 ? attention.join(", ") : "every last run went through",
                },
                {
                    label: "Next run",
                    icon: Clock,
                    value: next ? <RelativeTime date={next.at} /> : "-",
                    extra: next ? next.name : "no job runs on a schedule",
                },
                {
                    label: "Running",
                    icon: LoaderCircle,
                    value: running.count.toLocaleString(),
                    extra: running.count > 0
                        ? [...runningNames, ...(moreRunning > 0 ? [`${moreRunning.toLocaleString()} more`] : [])].join(", ")
                        : waiting > 0 ? `${waiting.toLocaleString()} waiting for a slot` : "nothing runs right now",
                },
            ]}
        />
    );
}
