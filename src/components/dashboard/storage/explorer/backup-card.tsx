"use client";

import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { isPlainClick } from "@/components/ui/row-click";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatBytes } from "@/lib/utils";
import type { BackupRun, ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import { copiesIn, isLocked, verificationOf } from "./backup-filters";
import { BackupFlags, CopyChips, IntegrityBadge, JobTile, TypeChip } from "./explorer-cells";
import { madeAt, snapshotBytes, startedBy } from "./explorer-format";

interface BackupCardProps {
    run: BackupRun;
    job: ExplorerJob | undefined;
    destinations: Map<string, ExplorerDestination>;
    /** The destinations of the filter, which the copies, the check and the lock are counted at. */
    at: string[];
    onOpen: (run: BackupRun) => void;
    /** The menu, the same as at the end of a table row. */
    actions: React.ReactNode;
}

/**
 * One backup as a card, the second view of the list and the one a phone always gets: its job and
 * when it was made, where its copies lie, and its check, size and menu at the foot.
 */
export function BackupCard({ run, job, destinations, at, onOpen, actions }: BackupCardProps) {
    const started = startedBy(run.file);
    const date = madeAt(run.file);
    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen(run)}
            className="flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20 group-data-[state=open]/row:border-foreground/20"
        >
            <div className="flex items-start gap-3">
                {job && <JobTile job={job} />}
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => onOpen(run)}
                        className={cn(
                            "block max-w-full truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50",
                            job?.kind !== "job" && "text-muted-foreground"
                        )}
                    >
                        {job?.name ?? "Without a job"}
                    </button>
                    <p className="truncate text-xs text-muted-foreground">
                        <DateDisplay date={date} format="Pp" /> · <RelativeTime date={date} />
                        {started && <> · {started.label}</>}
                    </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <TypeChip file={run.file} />
                    {job?.kind === "deleted" && <span className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium">Job deleted</span>}
                </div>
            </div>

            <CopyChips copies={copiesIn(run, at)} destinations={destinations} />

            <div className="mt-auto flex min-w-0 items-center gap-3 border-t pt-3">
                <IntegrityBadge verification={verificationOf(run, at)} />
                <BackupFlags file={{ locked: isLocked(run, at), isEncrypted: run.file.isEncrypted }} />
                <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">{formatBytes(snapshotBytes(run.file))}</span>
                <div className="-mr-2 shrink-0">{actions}</div>
            </div>
        </div>
    );
}
