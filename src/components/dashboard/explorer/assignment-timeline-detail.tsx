"use client";

import { X } from "lucide-react";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import { backupsIn, daysHeld, type HoldLine, type HoldSegment } from "./assignment-timeline-model";
import { countOf, movedText } from "./assignment-model";

interface HoldDetailProps {
    line: HoldLine;
    segment: HoldSegment;
    /** The segment after it, which says how its time ended. */
    next: HoldSegment | null;
    /** When the backups of the database were made, of the ones kept. */
    dates: string[] | undefined;
    /** The tenant of the server. */
    tenantName: string;
    now: Date;
    onClose: () => void;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-sm">{children}</dd>
        </div>
    );
}

/** How a stretch ended, by what came after it. */
function endedText(next: HoldSegment | null, tenantName: string, name: string): React.ReactNode {
    if (!next) return "It lasts";
    if (next.movedTo) return <>moved {movedText(next.movedTo, name)}</>;
    if (next.via === "assignment") return <>{next.tenantName} got it by name</>;
    if (next.via === "rule") return <>the rule <span className="font-mono">{next.pattern}</span> gave it to {next.tenantName}</>;
    return <>taken back, only {tenantName} since</>;
}

/** The stretch picked in the timeline: who held the database, how, from when to when and the backups of that time. */
export function HoldDetail({ line, segment, next, dates, tenantName, now, onClose }: HoldDetailProps) {
    const days = daysHeld(segment, now);
    const kept = backupsIn(dates, segment);
    const holder = segment.tenantName ?? `Only ${tenantName}`;
    return (
        <section aria-label={`${line.name} with ${holder}`} className="mx-5 mb-5 rounded-lg border bg-muted/20 p-4">
            <div className="flex items-start gap-3">
                <p className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold">{line.name} with {holder}</span>
                    <span className="ml-2 text-xs text-muted-foreground">picked in the timeline</span>
                </p>
                <Button variant="ghost" className="size-8 shrink-0 p-0" onClick={onClose} aria-label="Close the details">
                    <X />
                </Button>
            </div>
            <dl className="mt-3 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
                <Fact label="Database">{line.name}{!line.listed && <span className="text-muted-foreground">, no longer on the server</span>}</Fact>
                <Fact label="Tenant">
                    {segment.tenantName ? (
                        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
                            <TenantTileMark name={segment.tenantName} className="size-4 rounded-sm border-0 bg-transparent text-[8px]" />
                            <span className="truncate">{segment.tenantName}</span>
                        </span>
                    ) : <span className="text-muted-foreground">Nobody else</span>}
                </Fact>
                <Fact label="Held">
                    {segment.from === null ? "From the start" : <DateDisplay date={new Date(segment.from)} format="P" />}
                    {" to "}
                    {segment.to === null ? "now" : <DateDisplay date={new Date(segment.to)} format="P" />}
                    {days !== null && <span className="text-muted-foreground">, {countOf(days, "day")}</span>}
                </Fact>
                <Fact label="How">
                    {segment.via === "assignment"
                        ? <>Given by name{segment.byName && <> by {segment.byName}</>}</>
                        : segment.via === "rule"
                            ? <>The rule <span className="font-mono">{segment.pattern}</span></>
                            : segment.movedTo ? <>Moved {movedText(segment.movedTo, line.name)}</> : "Given to nobody"}
                </Fact>
                <Fact label="Ended">
                    {segment.to === null ? "It lasts" : <><DateDisplay date={new Date(segment.to)} format="P" />, {endedText(next, tenantName, line.name)}</>}
                </Fact>
                <Fact label="Backups of that time">
                    {countOf(kept, "backup")} still kept{segment.tenantName && kept > 0 && segment.to !== null && <span className="text-muted-foreground">, {segment.tenantName} downloads them as former</span>}
                </Fact>
            </dl>
        </section>
    );
}
