"use client";

import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { LogEntry } from "@/lib/core/logs";
import { formatLogsAsText, generateLogFilename } from "@/lib/logs/format";
import { sanitizeLogs } from "@/lib/logs/sanitize";
import type { RunDetail } from "@/services/history/run-types";

const TRIGGER: Record<string, string> = { schedule: "Scheduler", manual: "Manual", api: "Api" };

/** The whole log of a run as text, without passwords or keys. */
export function logText(run: RunDetail): string {
    const entries: LogEntry[] = run.steps.flatMap((step) => step.lines.map((line) => ({
        timestamp: line.at, level: line.level, type: line.type, message: line.message, stage: step.name, details: line.details,
    })));
    return formatLogsAsText(sanitizeLogs(entries), {
        jobName: run.job?.name ?? run.name,
        type: run.type,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        triggerType: TRIGGER[run.starter.kind] ?? null,
        triggerLabel: run.starter.label,
    });
}

/** Copy and Download of the log, the same on every tab of the page of a run. */
export function LogActions({ run }: { run: RunDetail }) {
    const purged = run.logsPurgedAt !== null;
    const copy = () => navigator.clipboard.writeText(logText(run)).then(() => toast.success("The log is copied")).catch(() => toast.error("The log could not be copied"));
    const download = () => {
        const url = URL.createObjectURL(new Blob([logText(run)], { type: "text/plain" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = generateLogFilename(run.job?.name ?? run.name, run.startedAt);
        link.click();
        URL.revokeObjectURL(url);
    };
    return (
        <>
            <Button variant="outline" size="icon" className="size-8" onClick={copy} disabled={purged} aria-label="Copy the log"><Copy /></Button>
            <Button variant="outline" size="icon" className="size-8" onClick={download} disabled={purged} aria-label="Download the log"><Download /></Button>
        </>
    );
}
