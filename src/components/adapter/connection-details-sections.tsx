"use client";

import Link from "next/link";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ConnectionRole, ConnectionUsage } from "@/services/adapters/connection-details";
import type { HealthBucket } from "@/services/adapters/connection-overview";
import { LastRunCell, Muted } from "./connection-cells";

const BUCKETS: Record<HealthBucket, string> = {
    ok: "bg-success",
    failed: "bg-warning",
    offline: "bg-destructive",
    none: "bg-muted",
};

const ROLES: Record<ConnectionRole, string> = {
    source: "Source",
    destination: "Destination",
    directory: "Directory source",
    notification: "Notifications",
};

export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold">{title}</h3>
                {aside && <span className="text-xs text-muted-foreground tabular-nums">{aside}</span>}
            </div>
            {children}
        </section>
    );
}

interface IssueProps {
    status: "DEGRADED" | "OFFLINE";
    error?: string | null;
    failures?: number;
    lastPassedAt?: string | null;
}

/** Why a connection needs attention, in words, with the last check that still passed. */
export function IssueBanner({ status, error, failures = 1, lastPassedAt }: IssueProps) {
    const offline = status === "OFFLINE";
    const Icon = offline ? CircleAlert : TriangleAlert;
    return (
        <div
            className={cn(
                "relative flex gap-3 overflow-hidden rounded-lg border p-3 pl-4",
                offline ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5"
            )}
        >
            <span className={cn("absolute inset-y-0 left-0 w-1", offline ? "bg-destructive" : "bg-warning")} aria-hidden="true" />
            <Icon className={cn("mt-0.5 size-4 shrink-0", offline ? "text-destructive" : "text-warning")} aria-hidden="true" />
            <div className="min-w-0 space-y-1 text-sm">
                <p className="font-medium">
                    {offline ? "Offline" : `${failures} failed health check${failures === 1 ? "" : "s"} in a row`}
                </p>
                <p className="text-muted-foreground wrap-anywhere">
                    {error ?? (offline ? "The last health checks got no answer." : "The last check got no answer.")}
                    {!offline && " Three failed checks in a row mark it offline."}
                    {lastPassedAt && <> The last check that passed was <RelativeTime date={lastPassedAt} />.</>}
                </p>
            </div>
        </div>
    );
}

export interface DetailStat {
    label: string;
    value: React.ReactNode;
    extra?: React.ReactNode;
    className?: string;
}

/**
 * The headline numbers of a connection, in the strip style of the dashboard. The cells take
 * the colour of the surface they sit on, so the gaps between them draw the dividers.
 */
export function DetailStats({ stats }: { stats: DetailStat[] }) {
    return (
        <div className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border", stats.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
            {stats.map((stat) => (
                <div key={stat.label} className="min-w-0 bg-card px-3 py-2.5">
                    <div className="truncate text-xs text-muted-foreground">{stat.label}</div>
                    <div className={cn("mt-1 truncate text-base font-semibold tabular-nums", stat.className)}>{stat.value}</div>
                    {stat.extra && <div className="truncate text-xs text-muted-foreground">{stat.extra}</div>}
                </div>
            ))}
        </div>
    );
}

/** One bar per hour of the last day, larger than the one in the table. */
export function HealthTimeline({ buckets }: { buckets: HealthBucket[] }) {
    return (
        <div>
            <div className="flex h-10 items-stretch gap-0.75" aria-hidden="true">
                {buckets.map((bucket, hour) => (
                    <span key={hour} className={cn("flex-1 rounded-sm", BUCKETS[bucket])} />
                ))}
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                <span>24h ago</span>
                <span>12h ago</span>
                <span>now</span>
            </div>
        </div>
    );
}

interface UsageListProps {
    usage: ConnectionUsage | null | undefined;
    /** The counts from the list, for users who may not see the jobs themselves. */
    counts: { jobs: number; templates: number } | undefined;
    canViewHistory: boolean;
}

/** The jobs and templates that use the connection, each job with its last backup. */
export function UsageList({ usage, counts, canViewHistory }: UsageListProps) {
    if (usage === undefined) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
            </div>
        );
    }

    if (usage === null) {
        const jobs = counts?.jobs ?? 0;
        return (
            <p className="text-sm text-muted-foreground">
                {jobs > 0 ? `${jobs} job${jobs === 1 ? "" : "s"} use this connection.` : "No job uses this connection."} Seeing which
                ones needs the permission to view jobs.
            </p>
        );
    }

    if (usage.jobs.length === 0 && usage.templates.length === 0) {
        return <p className="text-sm text-muted-foreground">Nothing uses this connection. Deleting it breaks no job.</p>;
    }

    return (
        <ul className="divide-y rounded-lg border">
            {usage.jobs.map((job) => (
                <li key={job.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                        {canViewHistory && job.lastRun ? (
                            <Link
                                href={`/dashboard/history?executionId=${job.lastRun.id}`}
                                className="block truncate text-sm font-medium hover:underline hover:underline-offset-4"
                            >
                                {job.name}
                            </Link>
                        ) : (
                            <span className="block truncate text-sm font-medium">{job.name}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                            {ROLES[job.role]}
                            {!job.enabled && " · Paused"}
                        </span>
                    </div>
                    <LastRunCell run={job.lastRun} never="No backup yet" />
                </li>
            ))}
            {usage.templates.map((template) => (
                <li key={template.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{template.name}</span>
                        <span className="text-xs text-muted-foreground">Notification template</span>
                    </div>
                </li>
            ))}
        </ul>
    );
}

/** Label and value pairs, two columns wide on larger screens. */
export function FactList({ facts }: { facts: { label: string; value: React.ReactNode }[] }) {
    if (facts.length === 0) return <Muted>Nothing to show.</Muted>;
    return (
        <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {facts.map((fact) => (
                <div key={fact.label} className="flex min-w-0 items-baseline justify-between gap-3 border-b py-2 text-sm">
                    <dt className="shrink-0 text-muted-foreground">{fact.label}</dt>
                    <dd className="min-w-0 truncate text-right">{fact.value}</dd>
                </div>
            ))}
        </dl>
    );
}
