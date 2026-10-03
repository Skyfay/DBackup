"use client";

import { useEffect, useMemo, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { gridTemplate, TimelineAxis, TimelineBands, useColumns, useTimelineWindow } from "@/components/dashboard/storage/explorer/timeline-frame";
import { useTimelineFormat } from "@/components/dashboard/storage/explorer/timeline-cells";
import type { DayKey } from "@/components/dashboard/storage/explorer/timeline-model";
import { TimelineNav, toDate } from "@/components/dashboard/storage/explorer/timeline-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipHead, TooltipTrigger } from "@/components/ui/tooltip";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { AuditTimeline as AuditTimelineModel, AuditTimelineRow } from "@/services/audit/audit-types";
import { ActorFace } from "./audit-cells";

const log = logger.child({ component: "audit-timeline" });

/** A person, a day or a day of a person, which the list below shows. */
export interface AuditPick {
    who?: string;
    whoName?: string;
    day?: DayKey;
    /** The days in view when a person was picked, whose entries of those days the list shows. */
    from?: DayKey;
    to?: DayKey;
}

interface AuditTimelineProps {
    /** The filters of the list but its period, as the query of a request. */
    filterQuery: string;
    pick: AuditPick | null;
    onPick: (pick: AuditPick | null) => void;
}

const same = (pick: AuditPick | null, next: AuditPick) => pick !== null && pick.who === next.who && pick.day === next.day;

/**
 * The second view of the Audit log: a row per person and API key and a column per day, as many
 * days as fit. A bar says how much someone did on a day, its amber part what handed out data, and
 * failed sign-ins count in a row of their own. A person, a day or a bar picks what the list shows.
 */
export function AuditTimeline({ filterQuery, pick, onPick }: AuditTimelineProps) {
    const format = useTimelineFormat();
    const { timezone } = useDateFormatter();
    const { ref, cols } = useColumns();
    const today = format.dayOf(new Date().toISOString());
    const { days, last, toToday, back, forward, center } = useTimelineWindow(cols, today);
    const [model, setModel] = useState<AuditTimelineModel | null>(null);
    const start = days[0];
    const end = days[days.length - 1];

    useEffect(() => {
        if (cols === 0) return;
        let ignore = false;
        const params = new URLSearchParams(filterQuery);
        params.set("start", start);
        params.set("end", end);
        params.set("tz", timezone);
        fetch(`/api/audit/timeline?${params.toString()}`)
            .then((response) => response.json())
            .then((body) => {
                if (!ignore && body?.success) setModel(body.data as AuditTimelineModel);
            })
            .catch((error) => log.error("Loading the audit timeline failed", {}, wrapError(error)));
        return () => {
            ignore = true;
        };
    }, [cols, start, end, timezone, filterQuery]);

    const shown = model && model.from === start && model.to === end ? model : null;
    const peak = useMemo(() => Math.max(1, ...(shown?.rows ?? []).flatMap((row) => Object.values(row.days).map((cell) => cell.count))), [shown]);
    const failedDays = useMemo(() => {
        const unknown = shown?.rows.find((row) => row.actor.kind === "unknown");
        return unknown ? Object.keys(unknown.days).map(toDate) : [];
    }, [shown]);

    const toggle = (next: AuditPick) => onPick(same(pick, next) ? null : next);
    const template = gridTemplate(cols);
    const pickedDay = pick && !pick.who ? pick.day ?? null : null;

    return (
        <div ref={ref} className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0">
                    <p className="font-semibold">Who did what, by day</p>
                    <p className="truncate text-sm text-muted-foreground">The amber part handed out data, a click lists the entries below</p>
                </div>
                <TimelineNav
                    days={days}
                    today={today}
                    last={last}
                    ahead={false}
                    future={false}
                    ready={cols > 0}
                    pickedDay={pickedDay}
                    problems={failedDays}
                    problemLabel="A failed sign-in"
                    onToday={toToday}
                    onBack={back}
                    onForward={forward}
                    onJump={(day) => {
                        center(day);
                        onPick({ day });
                    }}
                />
            </div>

            {cols === 0 || !shown ? (
                <div className="px-5 pb-4"><Skeleton className="h-48 w-full" /></div>
            ) : shown.rows.length === 0 ? (
                <p className="border-t px-5 py-10 text-center text-sm text-muted-foreground">No entries on these days with these filters.</p>
            ) : (
                <div className="relative">
                    <TimelineBands days={days} today={today} pickedDay={pickedDay} template={template} />
                    <TimelineAxis days={days} today={today} pickedDay={pickedDay} template={template} format={format} onPickDay={(day) => toggle({ day })} />
                    {shown.rows.map((row) => (
                        <TimelineActorRow key={row.actor.key} row={row} days={days} template={template} peak={peak} pick={pick} format={format} onToggle={toggle} range={{ from: start, to: end }} />
                    ))}
                </div>
            )}

            {!pick && (
                <p className="flex items-center justify-center gap-2 border-t px-5 py-5 text-sm text-muted-foreground">
                    <MousePointerClick className="size-4" aria-hidden="true" />
                    Pick a person, a day or one of the bars, and its entries show here
                </p>
            )}
        </div>
    );
}

interface RowProps {
    row: AuditTimelineRow;
    days: DayKey[];
    template: React.CSSProperties;
    peak: number;
    pick: AuditPick | null;
    format: ReturnType<typeof useTimelineFormat>;
    onToggle: (pick: AuditPick) => void;
    /** The days in view, which a pick of the whole row covers. */
    range: { from: DayKey; to: DayKey };
}

function TimelineActorRow({ row, days, template, peak, pick, format, onToggle, range }: RowProps) {
    const { actor } = row;
    const rowPicked = pick?.who === actor.key;
    const failedRow = actor.kind === "unknown";
    return (
        <div className={cn("relative grid items-end border-b px-5 py-1.5", rowPicked && !pick?.day && "bg-foreground/[0.035]")} style={template}>
            <button
                type="button"
                onClick={() => onToggle({ who: actor.key, whoName: actor.name, ...range })}
                aria-pressed={rowPicked && !pick?.day}
                className="flex min-w-0 items-center gap-2.5 self-center rounded-md pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
                <ActorFace actor={actor} />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{failedRow ? "Failed sign-ins and unknown" : actor.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{failedRow ? "nobody signed in" : actor.deleted ? "deleted since" : actor.sub}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.total}</span>
            </button>
            {days.map((day) => {
                const cell = row.days[day];
                const picked = rowPicked && pick?.day === day;
                if (!cell) return <span key={day} className="h-9" />;
                const height = Math.round(4 + (cell.count / peak) * 26);
                const warm = cell.sensitive > 0 ? Math.max(3, Math.round((height * cell.sensitive) / cell.count)) : 0;
                return (
                    <Tooltip key={day}>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                onClick={() => onToggle({ who: actor.key, whoName: actor.name, day })}
                                aria-label={`${actor.name}, ${format.date(day)}: ${cell.count} entries`}
                                aria-pressed={picked}
                                className={cn(
                                    "flex h-9 min-w-0 items-end justify-center rounded-md pb-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                                    picked && "ring-2 ring-foreground"
                                )}
                            >
                                {failedRow ? (
                                    <span className="mb-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-warning/15 px-1 text-[11px] font-semibold text-warning tabular-nums">{cell.count}</span>
                                ) : (
                                    <span className="flex w-3.5 flex-col justify-end overflow-hidden rounded-[3px] bg-foreground/50" style={{ height }}>
                                        {warm > 0 && <span className="block bg-warning" style={{ height: Math.min(warm, height) }} />}
                                    </span>
                                )}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-60">
                            {cell.sensitive > 0 || failedRow ? <TooltipHead tone="warning">{format.date(day)}</TooltipHead> : <p className="font-medium">{format.date(day)}</p>}
                            <p className="text-muted-foreground">
                                {failedRow
                                    ? `${cell.count} ${cell.count === 1 ? "entry" : "entries"} without anybody signed in`
                                    : `${cell.count} ${cell.count === 1 ? "entry" : "entries"} by ${actor.name}${cell.sensitive > 0 ? `, ${cell.sensitive} of them handed out data` : ""}`}
                            </p>
                        </TooltipContent>
                    </Tooltip>
                );
            })}
        </div>
    );
}
