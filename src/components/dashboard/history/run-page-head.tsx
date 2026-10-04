"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, ArrowLeft, CalendarClock, ChevronLeft, ChevronRight, History, Play, Square } from "lucide-react";
import { ExecutionStatusBadge } from "@/components/dashboard/widgets/execution-status";
import { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickGroup } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateDisplay } from "@/components/utils/date-display";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { formatBytes, formatDuration } from "@/lib/utils";
import type { RunDetail, RunNeighbour } from "@/services/history/run-types";
import { CancelRunDialog } from "./cancel-run-dialog";
import { startRun } from "./run-actions";
import { RunTile } from "./run-cells";
import { typeLabel } from "./run-format";
import { originOf, runHref, type RunOrigin } from "./run-links";
import type { RunAccess } from "./run-rail";

const STATUS_WORDS: Record<string, string> = { Success: "Done", Failed: "Failed", Partial: "Partial", Running: "Running", Pending: "Queued", Cancelled: "Cancelled" };

/** Opens another run of the same job, grouped by day. */
function RunSwitcher({ run, go }: { run: RunDetail; go: (id: string) => void }) {
    const [open, setOpen] = useState(false);
    const { formatDate } = useDateFormatter();
    const days = new Map<string, RunNeighbour[]>();
    for (const entry of run.recent) {
        const day = formatDate(entry.startedAt, "P");
        days.set(day, [...(days.get(day) ?? []), entry]);
    }
    const groups: PickGroup[] = [...days].map(([day, entries]) => ({
        heading: day,
        entries: entries.map((entry) => ({
            id: entry.id,
            name: formatDate(entry.startedAt, "p"),
            value: entry.id,
            meta: [STATUS_WORDS[entry.status] ?? entry.status, entry.durationMs !== null ? formatDuration(entry.durationMs) : null, entry.size ? formatBytes(entry.size) : null, entry.starter.label].filter(Boolean).join(" · "),
        })),
    }));
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <PickTrigger icon={History} size="sm" aria-expanded={open} aria-label={run.job ? "Open another run of this job" : "Open another run of this task"} className="w-full sm:w-64 sm:flex-none">
                    <span className="truncate"><DateDisplay date={run.startedAt} format="Pp" /><span className="text-muted-foreground"> · {STATUS_WORDS[run.status]}</span></span>
                </PickTrigger>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="end" className="w-96 overflow-hidden p-0">
                <PickList
                    icon={History}
                    title="Open another run"
                    note={`${run.job?.name ?? run.name}, the last ${run.recent.length} runs`}
                    groups={groups}
                    value={run.id}
                    emptyText="No run matches."
                    searchPlaceholder="Search by time or state"
                    onPick={(id) => {
                        setOpen(false);
                        if (id !== run.id) go(id);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}

/** Back to where the run was opened from, the run with its facts, and the ways to the runs around it. */
export function RunPageHead({ run, access, onChanged }: { run: RunDetail; access: RunAccess; onChanged: () => void }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const from = searchParams.get("from");
    const origin = originOf(from);
    const live = run.status === "Running" || run.status === "Pending";
    const [cancelling, setCancelling] = useState(false);
    // Stepping between runs replaces the address, so the arrow still leads back to where the first one was opened.
    const go = (id: string) => router.replace(runHref(id, origin.key as RunOrigin), { scroll: false });
    const back = () => {
        if (from && window.history.length > 1) router.back();
        else router.push(origin.href);
    };
    const facts = [
        typeLabel(run.type),
        run.starter.kind === "schedule" ? "by the schedule" : `by ${run.starter.label}`,
        run.durationMs !== null ? `took ${formatDuration(run.durationMs)}` : null,
    ].filter(Boolean).join(" · ");

    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <Button variant="outline" size="sm" className="shrink-0" onClick={back} aria-label={`Back to ${origin.label}`}>
                <ArrowLeft />{origin.label}
            </Button>
            <RunTile row={run} size="lg" />
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2.5">
                    <h2 className="truncate text-lg font-semibold tracking-tight">{run.name}</h2>
                    <ExecutionStatusBadge status={run.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground"><DateDisplay date={run.startedAt} format="PPpp" /> · {facts}</p>
            </div>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto">
                {(run.job || run.checks) && run.recent.length > 1 && <RunSwitcher run={run} go={go} />}
                {(run.job || run.checks) && (
                    <>
                        <Button variant="outline" size="icon" className="size-8" disabled={!run.previous} onClick={() => run.previous && go(run.previous.id)} aria-label="The run before"><ChevronLeft /></Button>
                        <Button variant="outline" size="icon" className="size-8" disabled={!run.next} onClick={() => run.next && go(run.next.id)} aria-label="The run after"><ChevronRight /></Button>
                    </>
                )}
                {run.job && access.canOpenJobs && (
                    <Button variant="outline" size="sm" asChild><Link href={`/dashboard/jobs?job=${encodeURIComponent(run.job.id)}`}><CalendarClock />Open job</Link></Button>
                )}
                {run.job && run.type === "Backup" && access.canOpenBackups && !live && (
                    <Button variant="outline" size="sm" asChild><Link href={`/dashboard/backups?job=${encodeURIComponent(run.job.id)}`}><Archive />Open backups</Link></Button>
                )}
                {run.checks && !run.checks.backup && access.canOpenBackups && (
                    <Button variant="outline" size="sm" asChild><Link href="/dashboard/backups"><Archive />Open backups</Link></Button>
                )}
                {run.job && run.type === "Backup" && access.canExecute && !live && (
                    <Button variant="outline" size="sm" onClick={() => void startRun(run.job!.id, run.job!.name).then((id) => (id ? go(id) : onChanged()))}><Play />Run again</Button>
                )}
                {live && access.canExecute && (
                    <Button variant="outline" size="sm" tone="destructive" className="border-tone/50 text-tone hover:text-tone" onClick={() => setCancelling(true)}><Square />Cancel run</Button>
                )}
            </div>
            <CancelRunDialog run={cancelling ? run : null} onClose={() => setCancelling(false)} onCancelled={onChanged} />
        </div>
    );
}
