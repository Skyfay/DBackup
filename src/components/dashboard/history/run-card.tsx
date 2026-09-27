"use client";

import Link from "next/link";
import { ExecutionStatusBadge } from "@/components/dashboard/widgets/execution-status";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatBytes } from "@/lib/utils";
import type { RunRow } from "@/services/history/run-types";
import { LiveBar, RunTile, StarterCell } from "./run-cells";
import { tookOf } from "./run-format";

/** A run on a phone, which has no room for the table. The whole card opens its page. */
export function RunCard({ row, href, now, actions }: { row: RunRow; href: string; now: number; actions: React.ReactNode }) {
    const tone = row.status === "Failed" ? "text-destructive" : row.status === "Partial" ? "text-warning" : "text-muted-foreground";
    const facts = [tookOf(row, now), row.size ? formatBytes(row.size) : null].filter((part) => part && part !== "-").join(" · ");
    return (
        <div className="relative min-w-0 rounded-xl border bg-card p-4 shadow-sm has-[a:focus-visible]:bg-muted/50">
            <div className="flex items-center gap-3">
                <RunTile row={row} />
                <Link href={href} className="min-w-0 flex-1 outline-none after:absolute after:inset-0">
                    <span className="block truncate font-medium">{row.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.sub}</span>
                </Link>
                <div className="relative z-10">{actions}</div>
            </div>
            <div className="mt-3 flex min-w-0 items-center gap-2">
                <ExecutionStatusBadge status={row.status} />
                {row.status === "Running" ? (
                    <>
                        <LiveBar percent={row.live?.percent ?? null} className="flex-1" />
                        {row.live?.percent != null && <span className="text-xs text-muted-foreground tabular-nums">{row.live.percent} %</span>}
                    </>
                ) : (
                    row.note && <span className={cn("truncate text-sm", tone)}>{row.note}</span>
                )}
            </div>
            <div className="mt-2 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                <span className="min-w-0 truncate tabular-nums"><DateDisplay date={row.startedAt} format="Pp" />{facts && ` · ${facts}`}</span>
                <span className="ml-auto shrink-0"><StarterCell starter={row.starter} /></span>
            </div>
        </div>
    );
}
