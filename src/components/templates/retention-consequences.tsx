"use client";

import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Skeleton } from "@/components/ui/skeleton";
import type { RetentionConfiguration } from "@/lib/core/retention";
import { cn } from "@/lib/utils";
import { removedByNextRun } from "@/services/templates/retention-preview";
import type { RetentionTargets } from "@/services/templates/templates-types";

export interface Consequence {
    key: string;
    adapterId: string;
    name: string;
    holds: number;
    removes: number;
    paused: boolean;
}

const plural = (value: number, noun: string) => `${value.toLocaleString()} ${value === 1 ? noun : `${noun}s`}`;

/** What the next run of each job removes at its destinations under a policy, the most first. */
export function consequencesOf(targets: RetentionTargets, config: RetentionConfiguration, now = Date.now()): Consequence[] {
    return targets.targets
        .map((target) => ({
            key: `${target.jobId}-${target.destinationId}`,
            adapterId: target.adapterId,
            name: `${target.destinationName} of ${target.jobName}`,
            holds: target.backups.length,
            removes: removedByNextRun(target, config, targets.timezone, now),
            paused: target.nextRun === null,
        }))
        .sort((a, b) => b.removes - a.removes || a.name.localeCompare(b.name));
}

/** How many backups the rows remove together, and at how many destinations. */
export function totalRemoved(rows: Consequence[]): { backups: number; destinations: number } {
    const removing = rows.filter((row) => row.removes > 0);
    return { backups: removing.reduce((sum, row) => sum + row.removes, 0), destinations: removing.length };
}

function Row({ row }: { row: Consequence }) {
    const keeps = row.holds - row.removes;
    return (
        <li className="px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
                <AdapterIcon adapterId={row.adapterId} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={row.name}>{row.name}</span>
                <span className={cn("shrink-0 text-xs tabular-nums", row.removes > 0 ? "font-medium text-warning" : "text-muted-foreground")}>
                    {row.removes > 0 ? `removes ${row.removes.toLocaleString()}` : "removes none"}
                </span>
            </div>
            {row.holds > 0 && (
                <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                    {/* The width is the share itself, the one value no class can hold. */}
                    <span className="bg-foreground/45" style={{ width: `${(keeps / row.holds) * 100}%` }} />
                    {row.removes > 0 && <span className="flex-1 bg-warning/60" />}
                </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {row.holds === 0 ? "holds no backup yet" : `holds ${row.holds.toLocaleString()}, keeps ${keeps.toLocaleString()}`}
                {row.paused && " · the job is paused"}
            </p>
        </li>
    );
}

interface RetentionConsequencesProps {
    targets: RetentionTargets | null;
    loading: boolean;
    config: RetentionConfiguration;
    /** Rows shown before the rest is counted in one line. */
    shown?: number;
    /** Ends with one sentence for all rows, left out where the head of the dialog says it already. */
    summary?: boolean;
}

/**
 * The destinations a policy reaches, each with what its next run removes, and one sentence for all
 * of them. Nothing is removed before a job runs, so the dialog says so.
 */
export function RetentionConsequences({ targets, loading, config, shown = 5, summary = true }: RetentionConsequencesProps) {
    const rows = useMemo(() => (targets ? consequencesOf(targets, config) : []), [targets, config]);
    const total = totalRemoved(rows);
    const rest = rows.slice(shown);

    if (loading) {
        return (
            <div className="space-y-2" aria-busy="true">
                <span className="sr-only">Working out what the next runs remove</span>
                {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
            </div>
        );
    }
    if (!targets) return <p className="text-sm text-muted-foreground">What the next runs remove could not be worked out.</p>;
    if (rows.length === 0) return <p className="text-sm text-muted-foreground">No destination follows it yet, so a change removes nothing.</p>;

    return (
        <div className="space-y-3">
            <ul className="divide-y rounded-lg border">
                {rows.slice(0, shown).map((row) => <Row key={row.key} row={row} />)}
                {rest.length > 0 && (
                    <li className="px-3 py-2 text-xs text-muted-foreground">
                        and {plural(rest.length, "more destination")}
                        {rest.every((row) => row.removes === 0) ? ", which remove none" : ""}
                    </li>
                )}
            </ul>
            {!summary ? null : total.backups > 0 ? (
                <div role="status" className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                    <TriangleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
                    <span>
                        The next runs remove {plural(total.backups, "backup")} at {plural(total.destinations, "destination")}. Nothing is removed on save.
                    </span>
                </div>
            ) : (
                <p className="text-xs text-muted-foreground">No destination loses a backup at its next run.</p>
            )}
            {targets.unlisted.length > 0 && (
                <p className="text-xs text-muted-foreground">
                    {plural(targets.unlisted.length, "destination")} {targets.unlisted.length === 1 ? "is" : "are"} not listed yet, so {targets.unlisted.length === 1 ? "its" : "their"} backups are not counted.
                </p>
            )}
        </div>
    );
}
