"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { madeAt, startedBy } from "@/components/dashboard/storage/explorer/explorer-format";
import { useExplorerData } from "@/components/dashboard/storage/explorer/explorer-data";
import type { FileInfo } from "@/components/dashboard/storage/file-info";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { encodeUrlPayload } from "@/lib/url-payload";
import { cn } from "@/lib/utils";
import type { BackupRun, ExplorerBackups } from "@/services/storage/explorer-types";

const DAY_MS = 86_400_000;
const WINDOW_MS = 30 * DAY_MS;

const normalize = (path: string) => path.replace(/\\/g, "/").replace(/^\/+/, "");

/** The copy of a run to restore from: the one at the same destination if it has one, else the first there is. */
function copyOf(run: BackupRun, destinationId: string) {
    const stored = run.copies.filter((copy) => copy.state === "stored" && copy.file);
    return stored.find((copy) => copy.destinationId === destinationId) ?? stored[0] ?? null;
}

interface RestoreTimelineProps {
    file: FileInfo;
    destinationId: string;
    /** The scope of the restore, kept when another backup is picked. */
    mode: string | null;
}

/**
 * Every backup of the job over a month as a small strip, the one being restored marked. A click on
 * another one restores that one instead, without going back to the Storage Explorer.
 */
export function RestoreTimeline({ file, destinationId, mode }: RestoreTimelineProps) {
    const router = useRouter();
    const { formatDate } = useDateFormatter();
    const backups = useExplorerData<ExplorerBackups>(file.jobId ? "/api/storage/explorer/runs" : null);
    const runs = useMemo(
        () => (backups.data?.runs ?? []).filter((run) => run.file.jobId === file.jobId).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
        [backups.data, file.jobId]
    );
    const current = normalize(file.path);
    const pickedAt = Date.parse(madeAt(file));
    // The month up to today, or the month around the backup when it is older.
    const [end, setEnd] = useState(() => (Date.now() - pickedAt > WINDOW_MS ? pickedAt + WINDOW_MS / 2 : Date.now()));
    const start = end - WINDOW_MS;
    const shown = runs.filter((run) => {
        const at = Date.parse(run.createdAt);
        return at >= start && at <= end;
    });

    const open = (run: BackupRun) => {
        const copy = copyOf(run, destinationId);
        if (!copy?.file) return;
        const scope = mode && mode !== "all" ? `&mode=${mode}` : "";
        router.push(`/dashboard/storage/restore?destinationId=${encodeURIComponent(copy.destinationId)}&file=${encodeURIComponent(encodeUrlPayload(copy.file))}${scope}`);
    };

    const label = (
        <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Restores the backup of</p>
            <p className="truncate text-sm font-semibold tabular-nums">{Number.isFinite(pickedAt) ? formatDate(new Date(pickedAt), "Pp") : file.name}</p>
        </div>
    );

    if (!file.jobId || backups.error || (backups.data && runs.length === 0)) {
        return <div className="rounded-xl border bg-card px-4 py-2.5">{label}</div>;
    }

    return (
        <div className="flex min-w-0 items-center gap-3 rounded-xl border bg-card py-1.5 pr-1.5 pl-4">
            {label}
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Older backups" onClick={() => setEnd(end - WINDOW_MS)}>
                <ChevronLeft />
            </Button>
            {backups.loading ? (
                <Skeleton className="h-6 w-full min-w-40 flex-1 md:w-96" />
            ) : (
                <div className="relative h-10 min-w-40 flex-1 md:w-96" role="group" aria-label="Backups of this job">
                    <span className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
                    {shown.map((run) => {
                        const at = Date.parse(run.createdAt);
                        const picked = normalize(run.path) === current;
                        const who = startedBy(run.file);
                        const missing = run.copies.some((copy) => copy.state === "missing");
                        return (
                            <Tooltip key={run.path}>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        onClick={() => !picked && open(run)}
                                        aria-current={picked ? "true" : undefined}
                                        aria-label={`${picked ? "Restoring" : "Restore"} the backup of ${formatDate(new Date(at), "Pp")}`}
                                        className={cn(
                                            "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                                            picked ? "size-4 bg-warning ring-4 ring-warning/25" : "size-2 bg-foreground/55 hover:scale-150 hover:bg-foreground",
                                            !picked && missing && "border-[1.5px] border-dashed border-warning bg-transparent"
                                        )}
                                        style={{ left: `${((at - start) / WINDOW_MS) * 100}%` }}
                                    />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p className="font-medium">{formatDate(new Date(at), "Pp")}</p>
                                    <p className="text-muted-foreground">{[who?.label, missing ? "a copy is missing" : null, picked ? "the one restored" : "a click restores this one"].filter(Boolean).join(" · ")}</p>
                                </TooltipContent>
                            </Tooltip>
                        );
                    })}
                </div>
            )}
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Newer backups" disabled={end >= Date.now()} onClick={() => setEnd(Math.min(Date.now(), end + WINDOW_MS))}>
                <ChevronRight />
            </Button>
        </div>
    );
}
