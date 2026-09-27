"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuickFilter } from "@/components/ui/quick-filter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatBytes } from "@/lib/utils";
import type { RunCheckDestination, RunChecks, RunCopyCheck, RunDetail, RunStepState } from "@/services/history/run-types";
import { LiveBar } from "./run-cells";
import { LogActions } from "./run-log-actions";
import { Mono } from "./run-log-lines";
import { StepIcon } from "./run-steps-pane";

/** The page of an integrity check or a verification: every copy it checked, the one it checks now first. */

const PAGE_SIZE = 25;

const STATE_ICON: Record<RunCopyCheck["state"], RunStepState> = { waiting: "pending", checking: "running", passed: "done", failed: "failed", skipped: "skipped", error: "failed" };

/** The copy checked now first, then what differs, then what was skipped, then the newest checks. */
function ordered(copies: RunCopyCheck[]): RunCopyCheck[] {
    const rank = (copy: RunCopyCheck) => ({ checking: 0, failed: 1, error: 2, skipped: 3, waiting: 4, passed: 5 })[copy.state];
    return copies.map((copy, index) => ({ copy, index })).sort((a, b) => rank(a.copy) - rank(b.copy) || b.index - a.index).map((entry) => entry.copy);
}

function howOf(copy: RunCopyCheck, destination: RunCheckDestination | undefined): string {
    if (copy.method === "download") return copy.state === "checking" ? "downloads it to hash it" : "downloaded and hashed";
    if (copy.method === "native" || (copy.state === "checking" && destination?.native)) return "its own checksum";
    return "-";
}

function short(hash: string | null): string {
    return hash ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : "unknown";
}

function Result({ copy }: { copy: RunCopyCheck }) {
    if (copy.state === "checking") {
        const percent = copy.processed !== null && copy.total ? Math.round((copy.processed / copy.total) * 100) : null;
        return (
            <span className="flex min-w-0 items-center gap-2.5">
                <LiveBar percent={percent} className="w-20 shrink-0" />
                <span className="truncate text-sm tabular-nums">{percent !== null ? `${percent} % · ${formatBytes(copy.processed!)} of ${formatBytes(copy.total!)}` : "checking"}</span>
            </span>
        );
    }
    if (copy.state === "failed") return <Mono tone="error">{`expected ${short(copy.expected)}, got ${short(copy.actual)}`}</Mono>;
    if (copy.state === "passed") return <span className="text-muted-foreground">matches</span>;
    return <span className={cn("truncate", copy.state === "error" ? "text-destructive" : "text-muted-foreground")}>{copy.reason ?? copy.state}</span>;
}

function fileParts(file: string): { name: string; folder: string | null } {
    const parts = file.split("/").filter(Boolean);
    return { name: parts.at(-1) ?? file, folder: parts.length > 1 ? parts[0] : null };
}

interface RunChecksCardProps {
    run: RunDetail;
    checks: RunChecks;
    tabs: React.ReactNode;
    className?: string;
}

export function RunChecksCard({ run, checks, tabs, className }: RunChecksCardProps) {
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<"all" | "differ" | "skipped">("all");
    const [page, setPage] = useState(0);
    const destinations = useMemo(() => new Map(checks.destinations.map((entry) => [entry.id, entry])), [checks.destinations]);
    const verification = run.type === "Verification";

    const term = search.trim().toLowerCase();
    const differ = checks.copies.filter((copy) => copy.state === "failed").length;
    const skipped = checks.copies.filter((copy) => copy.state === "skipped" || copy.state === "error").length;
    const shown = ordered(checks.copies).filter((copy) => {
        if (filter === "differ" && copy.state !== "failed") return false;
        if (filter === "skipped" && copy.state !== "skipped" && copy.state !== "error") return false;
        return !term || copy.file.toLowerCase().includes(term) || (destinations.get(copy.destinationId)?.name.toLowerCase().includes(term) ?? false);
    });
    const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    const current = Math.min(page, pages - 1);
    const rows = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

    return (
        <section aria-label="Copies" className={className}>
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                {tabs}
                {!verification && (
                    <div className="relative w-full sm:w-48">
                        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search by job or file" aria-label="Search the copies" className="h-8 pl-8" />
                    </div>
                )}
                {(differ > 0 || skipped > 0) && (
                    <QuickFilter
                        aria-label="Show the copies"
                        value={filter}
                        onChange={(value) => { setFilter(value); setPage(0); }}
                        options={[
                            { value: "all", label: "All", count: checks.copies.length },
                            { value: "differ", label: "Differ", count: differ, dot: "bg-destructive" },
                            { value: "skipped", label: "Skipped", count: skipped },
                        ]}
                    />
                )}
                <span className="ml-auto flex items-center gap-1.5"><LogActions run={run} /></span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
                {checks.copies.length === 0 ? (
                    <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                        {run.status === "Running" || run.status === "Pending" ? "No copy checked yet, it lists the destinations first." : "It found no copy to check."}
                    </p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="pl-4">{verification ? "Copy" : "Backup"}</TableHead>
                                <TableHead>Destination</TableHead>
                                <TableHead>Size</TableHead>
                                <TableHead>How</TableHead>
                                <TableHead className="pr-4">Result</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((copy) => {
                                const destination = destinations.get(copy.destinationId);
                                const { name, folder } = fileParts(copy.file);
                                return (
                                    <TableRow
                                        key={`${copy.destinationId}|${copy.file}`}
                                        className={cn(copy.state === "checking" && "bg-info/5 hover:bg-info/10", copy.state === "failed" && "bg-destructive/5 hover:bg-destructive/10")}
                                    >
                                        <TableCell className="max-w-72 pl-4">
                                            <span className="flex min-w-0 items-center gap-2.5">
                                                <StepIcon state={STATE_ICON[copy.state]} className="size-3.5" />
                                                <span className="min-w-0">
                                                    <span className="block truncate font-medium">{verification ? name : folder ?? name}</span>
                                                    {!verification && folder && <span className="block truncate text-xs text-muted-foreground">{name}</span>}
                                                </span>
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <span className="flex items-center gap-2">
                                                {destination?.adapterId && <AdapterIcon adapterId={destination.adapterId} className="size-3.5 shrink-0" />}
                                                {destination?.name ?? copy.destinationId}
                                            </span>
                                        </TableCell>
                                        <TableCell className="tabular-nums">{copy.size !== null ? formatBytes(copy.size) : copy.total !== null ? formatBytes(copy.total) : "-"}</TableCell>
                                        <TableCell className="text-muted-foreground">{howOf(copy, destination)}</TableCell>
                                        <TableCell className="max-w-80 pr-4"><Result copy={copy} /></TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </ScrollArea>
            {shown.length > PAGE_SIZE && (
                <div className="flex items-center gap-3 border-t px-4 py-2.5 text-sm text-muted-foreground">
                    <span>{current * PAGE_SIZE + 1} to {Math.min((current + 1) * PAGE_SIZE, shown.length)} of {shown.length.toLocaleString()}</span>
                    <span className="ml-auto flex items-center gap-1.5 tabular-nums">
                        <Button variant="outline" size="icon" className="size-8" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="The page before"><ChevronLeft /></Button>
                        Page {current + 1} of {pages}
                        <Button variant="outline" size="icon" className="size-8" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="The next page"><ChevronRight /></Button>
                    </span>
                </div>
            )}
        </section>
    );
}

/** A destination with how far the check of its copies got, what matched green, what differs red, what was skipped gray. */
function DestinationRow({ destination, now }: { destination: RunCheckDestination; now: RunCopyCheck | undefined }) {
    const total = Math.max(destination.total, 1);
    const state: RunStepState | null = now ? "running" : destination.checked >= destination.total && destination.total > 0 ? (destination.differ > 0 ? "failed" : "done") : null;
    const notes = [
        destination.differ > 0 ? `${destination.differ} ${destination.differ === 1 ? "differs" : "differ"}` : null,
        destination.skipped > 0 ? `${destination.skipped} skipped` : null,
        destination.native ? "its own checksum" : "downloads each copy to hash it",
    ].filter(Boolean);
    return (
        <div className={cn("rounded-lg border px-3 py-2.5", now ? "border-info/30 bg-info/5" : "border-transparent")}>
            <div className="flex min-w-0 items-center gap-2 text-sm">
                {state && <StepIcon state={state} className="size-3.5" />}
                {destination.adapterId && <AdapterIcon adapterId={destination.adapterId} className="size-3.5 shrink-0" />}
                <span className="min-w-0 truncate font-medium">{destination.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{destination.checked.toLocaleString()} of {destination.total.toLocaleString()}</span>
            </div>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span className="bg-success/80" style={{ width: `${(destination.passed / total) * 100}%` }} />
                <span className="bg-destructive" style={{ width: `${(destination.differ / total) * 100}%` }} />
                <span className="bg-muted-foreground/50" style={{ width: `${(destination.skipped / total) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
                {notes.map((note, index) => (
                    <span key={index} className={cn(index === 0 && destination.differ > 0 && "text-destructive")}>{index > 0 && " · "}{note}</span>
                ))}
            </p>
            {now && <p className="mt-1 truncate text-xs"><span className="font-semibold text-info">now</span> {fileParts(now.file).name}</p>}
        </div>
    );
}

/** On the left of an integrity check or a verification: every destination with how far it got. */
export function DestinationsPane({ run, checks, className }: { run: RunDetail; checks: RunChecks; className?: string }) {
    const checking = checks.copies.find((copy) => copy.state === "checking");
    const checked = checks.copies.filter((copy) => copy.state !== "checking" && copy.state !== "waiting").length;
    return (
        <section aria-label="Destinations" className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm", className)}>
            <div className="px-5 pt-4 pb-3">
                <h2 className="font-semibold">Destinations</h2>
                <p className="text-sm text-muted-foreground">
                    {run.type === "Verification" ? `the ${checks.total === 1 ? "copy" : `${checks.total} copies`} of this backup` : `${checked.toLocaleString()} of ${checks.total.toLocaleString()} copies, one after the other`}
                </p>
            </div>
            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-1 px-2.5 pb-3">
                    {checks.destinations.length === 0 && <p className="px-2.5 pb-2 text-sm text-muted-foreground">Listing the destinations.</p>}
                    {checks.destinations.map((destination) => (
                        <DestinationRow key={destination.id} destination={destination} now={checking?.destinationId === destination.id ? checking : undefined} />
                    ))}
                </div>
            </ScrollArea>
        </section>
    );
}
