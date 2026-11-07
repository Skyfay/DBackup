"use client";

import { useMemo } from "react";
import { Archive, Clock, Copy, Layers, ShieldCheck } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { formatBytes } from "@/lib/utils";
import type { ExplorerJob } from "@/services/storage/explorer-types";
import { summarize } from "./backup-filters";
import { count, typeLabel } from "./explorer-format";
import { ExplorerStrip } from "./explorer-strip";
import { isSharedRun, type ListRun } from "./shared-runs";

interface BackupsStripProps {
    /** The backups the filters leave, the shared ones among them. */
    runs: ListRun[];
    /** The destinations of the filter, which the copies are counted at. */
    at: string[];
    /** Those destinations by name, for one of them. */
    scopeName: string;
    jobsByKey: Map<string, ExplorerJob>;
}

/**
 * The numbers above the list of every backup. Backups counts the shared ones too, the rest is about
 * the own backups, since a shared one lies in the archive of its provider. A list of shared backups
 * alone tells when the newest was made and how their checks went.
 */
export function BackupsStrip({ runs, at, scopeName, jobsByKey }: BackupsStripProps) {
    const own = useMemo(() => runs.filter((run) => !isSharedRun(run)), [runs]);
    const shared = runs.length - own.length;
    const basis = own.length > 0 || shared === 0 ? own : runs;
    const summary = useMemo(() => summarize(basis, at, jobsByKey), [basis, at, jobsByKey]);

    const [storedValue, storedUnit] = formatBytes(summary.stored, 1).split(" ");
    const newest: ListRun | null = summary.newest;
    const newestText = !newest
        ? undefined
        : isSharedRun(newest)
            ? `${newest.shared.database.databaseName} · shared by ${newest.shared.database.providerName}`
            : jobsByKey.get(newest.jobKey) ? `${jobsByKey.get(newest.jobKey)?.name} · ${typeLabel(newest.file)}` : undefined;
    const from = [
        own.length > 0 ? `from ${count(summary.jobs, "job")}${summary.deletedJobs > 0 ? ` and ${count(summary.deletedJobs, "deleted job")}` : ""}` : null,
        shared > 0 ? `${shared.toLocaleString()} of shared databases` : null,
    ].filter(Boolean).join(", ");

    return (
        <ExplorerStrip
            joined
            cells={[
                { label: "Backups", icon: Archive, value: runs.length.toLocaleString(), extra: from },
                {
                    label: "Stored",
                    icon: Layers,
                    value: storedValue,
                    unit: storedUnit,
                    extra: `${at.length === 1 ? `at ${scopeName}` : `at ${count(summary.destinations, "destination")}`}${shared > 0 ? ", shared ones not counted" : ""}`,
                },
                { label: "Newest", icon: Clock, value: newest ? <RelativeTime date={newest.createdAt} /> : "-", extra: newestText },
                {
                    label: "Copies",
                    icon: Copy,
                    value: (summary.copies - summary.missing).toLocaleString(),
                    unit: `of ${summary.copies.toLocaleString()}`,
                    tone: summary.missing > 0 ? "warning" : undefined,
                    extra: `${shared > 0 ? "Of your backups, " : ""}${summary.missing > 0 ? `${count(summary.missing, "copy", "copies")} missing` : "none missing"}`,
                },
                {
                    label: "Integrity",
                    icon: ShieldCheck,
                    value: summary.failed > 0 ? summary.failed.toLocaleString() : summary.verified.toLocaleString(),
                    unit: summary.failed > 0 ? "failed" : `of ${summary.runs.toLocaleString()} verified`,
                    tone: summary.failed > 0 ? "destructive" : undefined,
                    extra: summary.failed > 0 ? `${summary.verified.toLocaleString()} verified` : summary.locked > 0 ? `${summary.locked.toLocaleString()} locked` : undefined,
                },
            ]}
        />
    );
}
