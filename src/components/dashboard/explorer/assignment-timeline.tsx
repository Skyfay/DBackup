"use client";

import { useMemo, useState } from "react";
import { Database } from "lucide-react";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { cn } from "@/lib/utils";
import type { SourceAssignments } from "@/services/tenant/database-assignments";
import { HoldDetail } from "./assignment-timeline-detail";
import { heldBy, monthsIn, percentAt, rangeOf, type HoldLine, type HoldSegment, type TimelineRange } from "./assignment-timeline-model";

/** The lines shown before Show all, so a server with hundreds of databases stays short. */
const FIRST = 12;
const EVERY = "every";

export interface HoldPick {
    name: string;
    index: number;
}

interface AssignmentTimelineProps {
    id: string;
    data: SourceAssignments;
    lines: HoldLine[];
    /** The tenant of the server. */
    tenantName: string;
    now: Date;
    picked: HoldPick | null;
    onPick: (pick: HoldPick | null) => void;
}

function segmentText(segment: HoldSegment, tenantName: string): string {
    if (segment.movedTo) return `Moved to ${segment.movedTo.serverName} · only ${tenantName} here`;
    if (!segment.tenantName) return `Only ${tenantName}`;
    if (segment.via === "rule") return `${segment.tenantName} · rule ${segment.pattern}`;
    return segment.byName ? `${segment.tenantName} · by name, ${segment.byName}` : `${segment.tenantName} · by name`;
}

/** The sub line of a database: gone from the server, taken back, or how long the server has backed it up. */
function subLine(line: HoldLine, dates: string[] | undefined, format: (iso: string | Date, pattern: string) => string): string {
    if (!line.listed) return "no longer on the server";
    const last = line.segments[line.segments.length - 1];
    const before = line.segments[line.segments.length - 2];
    if (!last.tenantId && before?.tenantId && last.from !== null) return `taken back on ${format(new Date(last.from), "MMM d")}`;
    if (dates?.[0]) return `backed up since ${format(dates[0], "MMM d")}`;
    return "no backup kept";
}

/**
 * Who held each database of the server and when, as a timeline: a line per database, a filled
 * segment for each time a tenant held it, by name or by a rule, and a dashed one while only the
 * server's tenant did. A click on a segment shows its details below, with the backups of that time.
 */
export function AssignmentTimeline({ id, data, lines, tenantName, now, picked, onPick }: AssignmentTimelineProps) {
    const { formatDate } = useDateFormatter();
    const [range, setRange] = useState<TimelineRange>("year");
    const [tenant, setTenant] = useState<string>(EVERY);
    const [all, setAll] = useState(false);
    const span = useMemo(() => rangeOf(range, lines, data.backupDates, now), [range, lines, data.backupDates, now]);
    const months = useMemo(() => monthsIn(span), [span]);
    const shown = tenant === EVERY ? lines : lines.filter((line) => heldBy(line, tenant));
    const visible = all || picked ? shown : shown.slice(0, FIRST);
    const pickedLine = picked ? lines.find((line) => line.name === picked.name) ?? null : null;
    const pickedSegment = pickedLine && picked ? pickedLine.segments[picked.index] ?? null : null;

    return (
        <section id={id} aria-label="Who held each database" className="min-w-0 scroll-mt-4 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
            <div className="flex flex-wrap items-start gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">Who held each database</h3>
                    <p className="text-sm text-muted-foreground">Every time a tenant held a database, with its start and its end. A backup belongs to whoever held the database when it was made.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Select value={tenant} onValueChange={setTenant}>
                        <SelectTrigger size="sm" className="w-44" aria-label="Tenant">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={EVERY}>Every tenant</SelectItem>
                            {data.customers.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Tabs value={range} onValueChange={(value) => setRange(value as TimelineRange)}>
                        <TabsList className="h-8">
                            <TabsTrigger value="year" className="px-2.5 text-xs">12 months</TabsTrigger>
                            <TabsTrigger value="all" className="px-2.5 text-xs">From the start</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
            </div>

            <ScrollArea horizontal className="border-t">
                <div className="min-w-176 px-5 pb-2">
                    <div className="grid grid-cols-[15rem_minmax(0,1fr)] items-end gap-3 border-b py-2 text-xs text-muted-foreground">
                        <span>Database and who holds it now</span>
                        <div className="relative h-4">
                            {months.map((month) => (
                                <span key={month} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${percentAt(month, span)}%` }}>{formatDate(new Date(month + 43_200_000), "MMM")}</span>
                            ))}
                            <span className="absolute right-0 -translate-y-0.5 rounded-sm bg-foreground px-1 text-[10px] font-semibold text-background">Today</span>
                        </div>
                    </div>
                    {visible.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No database was held by this tenant.</p>}
                    {visible.map((line) => (
                        <div key={line.name} className="grid grid-cols-[15rem_minmax(0,1fr)] items-center gap-3 border-b py-2 last:border-b-0">
                            <div className="flex min-w-0 items-center gap-2.5">
                                <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span className="min-w-0 flex-1">
                                    <span className={cn("block truncate text-sm font-medium", !line.listed && "text-muted-foreground")}>{line.name}</span>
                                    <span className="block truncate text-xs text-muted-foreground">{subLine(line, data.backupDates[line.name], formatDate)}</span>
                                </span>
                                {line.current.tenantName ? (
                                    <span className="inline-flex max-w-24 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium" title={line.current.tenantName}>
                                        <TenantTileMark name={line.current.tenantName} className="size-4 rounded-sm border-0 bg-transparent text-[8px]" />
                                        <span className="truncate">{line.current.tenantName}</span>
                                    </span>
                                ) : <span className="shrink-0 text-[11px] text-muted-foreground">nobody else</span>}
                            </div>
                            <div className="relative h-8">
                                {months.map((month) => <span key={month} aria-hidden="true" className="absolute inset-y-0 w-px bg-border" style={{ left: `${percentAt(month, span)}%` }} />)}
                                {line.segments.map((segment, index) => {
                                    const left = percentAt(segment.from, span);
                                    const width = percentAt(segment.to ?? span.end, span) - left;
                                    if (width <= 0) return null;
                                    const isPicked = picked?.name === line.name && picked.index === index;
                                    const text = segmentText(segment, tenantName);
                                    return (
                                        <button
                                            key={index}
                                            type="button"
                                            onClick={() => onPick(isPicked ? null : { name: line.name, index })}
                                            aria-pressed={isPicked}
                                            aria-label={`${line.name}: ${text}`}
                                            title={text}
                                            className={cn(
                                                "absolute inset-y-0.5 flex min-w-1 items-center gap-1.5 overflow-hidden rounded-md px-1.5 text-left text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                                                segment.tenantId ? "border border-foreground/15 bg-foreground/10 font-medium hover:bg-foreground/15" : "border border-dashed border-input text-muted-foreground hover:bg-muted/50",
                                                isPicked && "ring-2 ring-foreground"
                                            )}
                                            style={{ left: `${left}%`, width: `${width}%` }}
                                        >
                                            {segment.tenantName && <TenantTileMark name={segment.tenantName} className="size-4 rounded-sm border-0 bg-card text-[8px]" />}
                                            <span className="truncate">{text}</span>
                                        </button>
                                    );
                                })}
                                <span aria-hidden="true" className="absolute inset-y-0 right-0 w-0.5 bg-foreground/60" />
                            </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-5 py-2.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm border border-foreground/15 bg-foreground/10" />Held by a tenant</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm border border-dashed border-input" />Only {tenantName}</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-foreground/60" />Today</span>
                {!all && !picked && shown.length > FIRST && (
                    <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setAll(true)}>Show all {shown.length.toLocaleString()} databases</Button>
                )}
            </div>

            {pickedLine && pickedSegment && picked && (
                <HoldDetail
                    line={pickedLine}
                    segment={pickedSegment}
                    next={pickedLine.segments[picked.index + 1] ?? null}
                    dates={data.backupDates[pickedLine.name]}
                    tenantName={tenantName}
                    now={now}
                    onClose={() => onPick(null)}
                />
            )}
        </section>
    );
}
