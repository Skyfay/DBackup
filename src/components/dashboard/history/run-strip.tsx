"use client";

import { Archive, Bell, CircleCheck, CircleSlash, CircleX, Copy, Layers, ListChecks, Timer, TriangleAlert, UserRound } from "lucide-react";
import { ExplorerStrip, type StripCell } from "@/components/dashboard/storage/explorer/explorer-strip";
import { stageLabel } from "@/lib/core/logs";
import { formatBytes, formatDuration } from "@/lib/utils";
import type { RunChecks, RunDetail } from "@/services/history/run-types";

function bytes(size: number | null): Pick<StripCell, "value" | "unit"> {
    if (!size) return { value: "-" };
    const [value, unit] = formatBytes(size, 1).split(" ");
    return { value, unit };
}

function time(run: RunDetail, live: boolean, elapsed: number): StripCell {
    return live
        ? { label: "Running for", icon: Timer, value: formatDuration(elapsed), extra: run.usualMs !== null ? `usual ${formatDuration(run.usualMs)} in all` : run.live?.stage ? stageLabel(run.live.stage) : " " }
        : { label: "Took", icon: Timer, value: run.durationMs !== null ? formatDuration(run.durationMs) : "-", extra: run.usualMs !== null ? `usual ${formatDuration(run.usualMs)}` : "no earlier run to compare" };
}

/** The numbers of an integrity check or a verification: how many copies it checked and how they came out. */
function checkCells(run: RunDetail, checks: RunChecks, live: boolean, elapsed: number): StripCell[] {
    const finished = checks.copies.filter((copy) => copy.state !== "checking" && copy.state !== "waiting");
    const passed = finished.filter((copy) => copy.state === "passed").length;
    const differ = finished.filter((copy) => copy.state === "failed");
    const skipped = finished.length - passed - differ.length;
    const folders = [...new Set(differ.map((copy) => copy.file.split("/")[0]))];
    return [
        {
            label: "Checked",
            icon: ListChecks,
            value: finished.length.toLocaleString(),
            unit: `of ${checks.total.toLocaleString()}`,
            extra: checks.backup ? `copies of ${checks.backup.name}` : `copies on ${checks.destinations.length} ${checks.destinations.length === 1 ? "destination" : "destinations"}`,
        },
        { label: "Match", icon: CircleCheck, value: passed.toLocaleString(), extra: passed > 0 && passed === finished.length ? "what was written is there" : finished.length === 0 ? "none checked yet" : " " },
        { label: "Differ", icon: CircleX, value: differ.length.toLocaleString(), tone: differ.length > 0 ? "destructive" : undefined, extra: differ.length > 0 ? folders.join(", ") : live ? "none so far" : "none" },
        checks.backup
            ? { label: "Backup", icon: Archive, value: checks.backup.name, extra: checks.backup.size !== null ? `${checks.backup.file} · ${formatBytes(checks.backup.size)}` : checks.backup.file }
            : { label: "Skipped", icon: CircleSlash, value: skipped.toLocaleString(), extra: skipped > 0 ? "nothing to compare with" : "none" },
        time(run, live, elapsed),
    ];
}

/** The numbers of a run: how long it took, what it wrote, where it went, who heard of it and what went wrong. */
export function RunStrip({ run, now }: { run: RunDetail; now: number }) {
    const live = run.status === "Running" || run.status === "Pending";
    const elapsed = Math.max(0, now - Date.parse(run.startedAt));
    if (run.checks) return <ExplorerStrip cells={checkCells(run, run.checks, live, elapsed)} />;
    const errors = run.problems.filter((problem) => problem.tone === "error").length;
    const warnings = run.problems.length - errors;
    const stored = run.uploads.filter((upload) => upload.state === "done").length;
    const failedCopies = run.uploads.filter((upload) => upload.state === "failed");
    const sent = run.notifications.filter((entry) => entry.status === "Success").length;
    const failedChannels = run.notifications.filter((entry) => entry.status === "Failed");
    const uploading = run.uploads.find((upload) => upload.state === "uploading");

    const cells: StripCell[] = [
        time(run, live, elapsed),
        { label: run.type === "Restore" ? "Read" : "Written", icon: Layers, ...bytes(run.size), extra: run.databases.length > 0 ? run.databases.join(", ") : live ? "when the run ends" : run.size ? " " : "nothing written" },
    ];
    // Five cells always, so the strip never ends in an empty one.
    if (run.type === "Backup") {
        cells.push({
            label: "Copies",
            icon: Copy,
            value: run.uploads.length > 0 ? `${stored} of ${run.uploads.length}` : "-",
            tone: failedCopies.length > 0 ? "warning" : undefined,
            extra: failedCopies.length > 0 ? `${failedCopies.map((upload) => upload.name).join(", ")} failed`
                : uploading ? `${uploading.name} is uploading`
                    : live ? "waiting to upload"
                        : run.uploads.length > 0 ? "at every destination" : "not recorded for this run",
        });
    } else {
        const how = { schedule: "by the schedule", manual: "by hand", api: "with an API key", none: "not recorded" }[run.starter.kind];
        cells.push({ label: "Started by", icon: UserRound, value: run.starter.kind === "schedule" ? "Schedule" : run.starter.label, extra: how });
    }
    cells.push({
        label: "Notifications",
        icon: Bell,
        value: run.notifications.length > 0 ? `${sent} of ${run.notifications.length}` : "-",
        tone: failedChannels.length > 0 ? "warning" : undefined,
        extra: failedChannels.length > 0 ? `${failedChannels.map((entry) => entry.channelName).join(", ")} failed` : live ? "sent when it ends" : run.notifications.length > 0 ? "every channel took it" : "none sent",
    });
    cells.push({
        label: "Problems",
        icon: TriangleAlert,
        value: errors.toLocaleString(),
        unit: errors === 1 ? "error" : "errors",
        tone: errors > 0 ? "destructive" : undefined,
        extra: warnings > 0 ? `and ${warnings} ${warnings === 1 ? "warning" : "warnings"} to read` : errors > 0 ? "to look at" : live ? "none so far" : "nothing went wrong",
    });
    return <ExplorerStrip cells={cells} />;
}
