"use client";

import Link from "next/link";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import type { LatestJobEntry } from "@/services/dashboard-service";
import { ExecutionStatusBadge } from "./execution-status";
import { RelativeTime } from "./relative-time";

interface ExecutionsListProps {
    executions: LatestJobEntry[];
    canViewHistory: boolean;
}

const COLUMNS = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_6.5rem_4.5rem_4.5rem_7.5rem]";

const TYPE_LABELS: Record<string, string> = {
    IntegrityCheck: "Integrity check",
};

function tookLabel(execution: LatestJobEntry): string {
    if (execution.status === "Pending") return "queued";
    if (execution.status === "Running") return formatDuration(Math.max(0, Date.now() - new Date(execution.startedAt).getTime()));
    return execution.duration > 0 ? formatDuration(execution.duration) : "-";
}

/** The most recent executions of any type, newest first. */
export function ExecutionsList({ executions, canViewHistory }: ExecutionsListProps) {
    if (executions.length === 0) {
        return <p className="px-4 py-10 text-center text-sm text-muted-foreground md:px-5">No executions yet.</p>;
    }

    return (
        <div>
            <div className={cn("hidden border-b px-5 pb-2 text-xs text-muted-foreground md:grid md:gap-x-4", COLUMNS)}>
                <span>Job</span>
                <span>Status</span>
                <span className="text-right">Took</span>
                <span className="text-right">Size</span>
                <span className="text-right">Started</span>
            </div>
            <ul className="divide-y">
                {executions.map((execution) => {
                    const took = tookLabel(execution);
                    const size = execution.size ? formatBytes(execution.size, 1) : "-";
                    const subtitle = [TYPE_LABELS[execution.type] ?? execution.type, execution.databaseName].filter(Boolean).join(" · ");
                    const rowClassName = cn(
                        "grid items-center gap-x-4 gap-y-1 px-4 py-3 md:px-5",
                        COLUMNS,
                        execution.status === "Running" && "bg-info/5",
                        execution.status === "Failed" && "bg-destructive/5"
                    );
                    const cells = (
                        <>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{execution.jobName}</p>
                                <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
                                <p className="truncate text-xs text-muted-foreground tabular-nums md:hidden" suppressHydrationWarning>
                                    {took} · {size} · <RelativeTime date={execution.startedAt} />
                                </p>
                            </div>
                            <div className="justify-self-end md:justify-self-start">
                                <ExecutionStatusBadge status={execution.status} />
                            </div>
                            <span className="hidden text-right text-xs text-muted-foreground tabular-nums md:block" suppressHydrationWarning>
                                {took}
                            </span>
                            <span className="hidden text-right text-xs text-muted-foreground tabular-nums md:block">{size}</span>
                            <RelativeTime date={execution.startedAt} className="hidden text-right text-xs text-muted-foreground md:block" />
                        </>
                    );

                    return (
                        <li key={execution.id}>
                            {canViewHistory ? (
                                <Link
                                    href={`/dashboard/history?executionId=${execution.id}`}
                                    className={cn(rowClassName, "outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50")}
                                >
                                    {cells}
                                </Link>
                            ) : (
                                <div className={rowClassName}>{cells}</div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
