"use client";

import { ExplorerStrip, type StripCell } from "@/components/dashboard/storage/explorer/explorer-strip";
import { formatBytes, formatDuration } from "@/lib/utils";
import type { RunDetail } from "@/services/history/run-types";

function bytes(size: number | null): Pick<StripCell, "value" | "unit"> {
    if (!size) return { value: "-" };
    const [value, unit] = formatBytes(size, 1).split(" ");
    return { value, unit };
}

/** The numbers of a run: how long it took, what it wrote, where it went, who heard of it and what went wrong. */
export function RunStrip({ run, now }: { run: RunDetail; now: number }) {
    const live = run.status === "Running" || run.status === "Pending";
    const elapsed = Math.max(0, now - Date.parse(run.startedAt));
    const errors = run.problems.filter((problem) => problem.tone === "error").length;
    const warnings = run.problems.length - errors;
    const stored = run.uploads.filter((upload) => upload.state === "done").length;
    const failedCopies = run.uploads.filter((upload) => upload.state === "failed");
    const sent = run.notifications.filter((entry) => entry.status === "Success").length;
    const failedChannels = run.notifications.filter((entry) => entry.status === "Failed");
    const uploading = run.uploads.find((upload) => upload.state === "uploading");

    const cells: StripCell[] = [
        live
            ? { label: "Running for", value: formatDuration(elapsed), extra: run.usualMs !== null ? `usual ${formatDuration(run.usualMs)} in all` : run.live?.stage ?? " " }
            : { label: "Took", value: run.durationMs !== null ? formatDuration(run.durationMs) : "-", extra: run.usualMs !== null ? `usual ${formatDuration(run.usualMs)}` : "no earlier run to compare" },
        { label: run.type === "Restore" ? "Read" : "Written", ...bytes(run.size), extra: run.databases.length > 0 ? run.databases.join(", ") : live ? "when the run ends" : run.size ? " " : "nothing written" },
    ];
    if (run.uploads.length > 0) {
        cells.push({
            label: "Copies",
            value: `${stored} of ${run.uploads.length}`,
            tone: failedCopies.length > 0 ? "warning" : undefined,
            extra: failedCopies.length > 0 ? `${failedCopies.map((upload) => upload.name).join(", ")} failed` : uploading ? `${uploading.name} is uploading` : live ? "waiting to upload" : "at every destination",
        });
    }
    cells.push({
        label: "Notifications",
        value: run.notifications.length > 0 ? `${sent} of ${run.notifications.length}` : "-",
        tone: failedChannels.length > 0 ? "warning" : undefined,
        extra: failedChannels.length > 0 ? `${failedChannels.map((entry) => entry.channelName).join(", ")} failed` : live ? "sent when it ends" : run.notifications.length > 0 ? "every channel took it" : "none sent",
    });
    cells.push({
        label: "Problems",
        value: errors.toLocaleString(),
        unit: errors === 1 ? "error" : "errors",
        tone: errors > 0 ? "destructive" : undefined,
        extra: warnings > 0 ? `and ${warnings} ${warnings === 1 ? "warning" : "warnings"} to read` : errors > 0 ? "to look at" : live ? "none so far" : "nothing went wrong",
    });
    return <ExplorerStrip cells={cells} />;
}
