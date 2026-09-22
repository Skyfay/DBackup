"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Clock, TriangleAlert, Unplug } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DialogHead, dialogNoteClass, type DialogTone } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { HealthCheck, HealthHistory } from "@/services/adapters/health-history";
import type { ConnectionHealth } from "./connection-cells";
import { durationText, failedInRow, healthEvents, type HealthTone } from "./health-story";

const log = logger.child({ component: "connection-health-popover" });

/** How many checks the popover shows, an hour at one check a minute. */
const CHECKS = 60;

const HEADS: Record<ConnectionHealth, { tone: DialogTone; icon: typeof Check }> = {
    ONLINE: { tone: "success", icon: Check },
    DEGRADED: { tone: "warning", icon: TriangleAlert },
    OFFLINE: { tone: "destructive", icon: Unplug },
    PENDING: { tone: "neutral", icon: Clock },
};

const BARS: Record<HealthCheck["status"], string> = { ONLINE: "bg-success", DEGRADED: "bg-warning", OFFLINE: "bg-destructive" };
const LABELS: Record<HealthCheck["status"], string> = { ONLINE: "Passed", DEGRADED: "Failed", OFFLINE: "Offline" };
const DOTS: Record<HealthTone, string> = { success: "bg-success", warning: "bg-warning", destructive: "bg-destructive" };

type Loaded = { id: string; data: HealthHistory; at: number } | { id: string; failed: true };

/** Loads the latest checks once the popover opens. */
function useHealthHistory(configId: string) {
    const [result, setResult] = useState<Loaded | null>(null);

    useEffect(() => {
        let ignore = false;
        fetch(`/api/adapters/${configId}/health-history?limit=${CHECKS}`)
            .then(async (res) => {
                if (!res.ok) throw new Error(`Health history request failed with ${res.status}`);
                return (await res.json()) as HealthHistory;
            })
            .then((data) => {
                if (!ignore) setResult({ id: configId, data, at: Date.now() });
            })
            .catch((error: unknown) => {
                if (ignore) return;
                log.error("Loading the health history failed", { configId }, error instanceof Error ? error : undefined);
                setResult({ id: configId, failed: true });
            });
        return () => {
            ignore = true;
        };
    }, [configId]);

    return result?.id === configId ? result : null;
}

interface ConnectionHealthPopoverProps {
    status: ConnectionHealth;
    configId: string;
    /** What the row already knows, shown until the checks have loaded. */
    lastCheckedAt?: string | null;
    detail?: string | null;
    error?: string | null;
    onOpenDetails?: () => void;
}

/**
 * What the health checks of one connection say. The head tells in one sentence how it is
 * doing and since when, the body shows the last hour and what changed in it.
 */
export function ConnectionHealthPopover({ status, configId, lastCheckedAt, detail, error, onOpenDetails }: ConnectionHealthPopoverProps) {
    const loaded = useHealthHistory(configId);
    const data = loaded && "data" in loaded ? loaded.data : null;
    const { tone, icon } = HEADS[status];
    const { title, note } = headline(status, data, loaded && "at" in loaded ? loaded.at : 0, { lastCheckedAt, detail, error });

    return (
        <>
            <DialogHead tone={tone} icon={icon} className="px-4 py-3">
                <p className="text-sm font-semibold">{title}</p>
                {note && (
                    <p className={cn(dialogNoteClass(tone), "truncate")} title={typeof note === "string" ? note : undefined}>
                        {note}
                    </p>
                )}
            </DialogHead>
            <div className="px-4 py-3">
                {!loaded ? (
                    <div className="space-y-2.5">
                        <span className="sr-only">Loading the health checks</span>
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                    </div>
                ) : !data ? (
                    <p className="text-sm text-destructive">The check history could not be loaded.</p>
                ) : data.history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No checks yet.</p>
                ) : (
                    <CheckHistory data={data} />
                )}
            </div>
            <div className="flex min-h-10 items-center justify-between gap-3 border-t bg-page/60 px-4 py-1.5">
                <span className="text-xs text-muted-foreground tabular-nums">{data && summary(data)}</span>
                {onOpenDetails && (
                    <Button variant="ghost" size="sm" className="-mr-2 h-7 px-2 text-xs" onClick={onOpenDetails}>
                        Show details
                        <ArrowRight />
                    </Button>
                )}
            </div>
        </>
    );
}

/** The sentence in the head and the short line under it. */
function headline(
    status: ConnectionHealth,
    data: HealthHistory | null,
    loadedAt: number,
    row: Pick<ConnectionHealthPopoverProps, "lastCheckedAt" | "detail" | "error">
): { title: string; note: React.ReactNode } {
    const since = data?.since ? durationText(loadedAt - Date.parse(data.since)) : null;
    const newest = data?.history[0];

    if (status === "ONLINE") {
        const latency = newest ? `${newest.latencyMs} ms` : row.detail;
        const checkedAt = newest?.createdAt ?? row.lastCheckedAt;
        return {
            title: since ? `Online for ${since}` : "Online",
            note: (
                <>
                    {latency}
                    {latency && checkedAt && " · "}
                    {checkedAt && <>checked <RelativeTime date={checkedAt} /></>}
                </>
            ),
        };
    }
    if (status === "DEGRADED") {
        const failed = data ? failedInRow(data.history) : 0;
        return {
            title: failed > 1 ? `${failed} checks failed in a row` : failed === 1 ? "The last check failed" : "Degraded",
            note: data?.lastPassedAt ? <>Last answer <RelativeTime date={data.lastPassedAt} /></> : data ? "No check has passed yet" : row.error,
        };
    }
    if (status === "OFFLINE") {
        return { title: since ? `Offline for ${since}` : "Offline", note: row.error || newest?.error || "No answer" };
    }
    return { title: "Not checked yet", note: "Waiting for the first health check" };
}

function summary(data: HealthHistory): string {
    if (data.history.length === 0) return "";
    return data.stats.uptime > 0 ? `avg ${data.stats.avgLatency} ms · max ${data.stats.maxLatency} ms` : "No answer in these checks";
}

/** The latest checks as a bar each, oldest on the left, and what changed in them. */
function CheckHistory({ data }: { data: HealthHistory }) {
    const { formatDate } = useDateFormatter();
    const checks = [...data.history].reverse();
    const empty = Math.max(0, CHECKS - checks.length);
    const passed = checks.filter((check) => check.status === "ONLINE").length;
    const uptime = data.stats.uptime;
    const events = healthEvents(data.history);

    return (
        <>
            <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                <span>Last {checks.length === 1 ? "check" : `${checks.length} checks`}</span>
                <span className="tabular-nums">{Number.isInteger(uptime) ? uptime : uptime.toFixed(1)}% passed</span>
            </div>
            <div className="flex h-3 items-stretch gap-0.5" role="img" aria-label={`${passed} of ${checks.length} checks passed`}>
                {Array.from({ length: empty }, (_, index) => (
                    <span key={`empty-${index}`} className="flex-1 rounded-xs bg-muted" />
                ))}
                {checks.map((check) => (
                    <span
                        key={check.id}
                        className={cn("flex-1 rounded-xs", BARS[check.status])}
                        title={`${formatDate(check.createdAt, "p")} · ${LABELS[check.status]} · ${check.status === "ONLINE" ? `${check.latencyMs} ms` : check.error || "no answer"}`}
                    />
                ))}
            </div>

            {events.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                    {events.map((event) => (
                        <li key={`${event.at}-${event.text}`} className="flex min-w-0 items-center gap-2.5 text-xs">
                            <time dateTime={event.at} className="w-14 shrink-0 text-muted-foreground tabular-nums">
                                {formatDate(event.at, "p")}
                            </time>
                            <span className={cn("size-1.5 shrink-0 rounded-full", DOTS[event.tone])} aria-hidden="true" />
                            <span className="min-w-0 truncate" title={event.text}>
                                {event.text}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mt-3 text-xs text-muted-foreground">{passed === checks.length ? "Every check passed." : "None of these checks passed."}</p>
            )}
        </>
    );
}
