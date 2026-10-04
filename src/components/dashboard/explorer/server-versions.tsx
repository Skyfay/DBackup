"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { VersionPage, VersionPeriod } from "@/services/databases/database-explorer-types";
import { useDatabaseData } from "./database-data";
import { timeOn } from "./server-model";

/** Versions a page, few enough for the card beside the databases. */
const SIZE = 5;

function Change({ change }: { change: VersionPeriod["change"] }) {
    if (!change) return <span className="text-xs text-muted-foreground">added to DBackup</span>;
    if (change.kind === "down") {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-warning">
                <ArrowDown className="size-3" aria-hidden="true" />
                from {change.from}, an older one
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowUp className="size-3" aria-hidden="true" />
            from {change.from}
        </span>
    );
}

/** The backups a version made and how many of them are kept, with a bar against the most on the page. */
function Backups({ period, most }: { period: VersionPeriod; most: number }) {
    const { kept, made } = period;
    if (kept === null && made === null) return <span className="text-muted-foreground">-</span>;
    if (kept === null) return <span className="tabular-nums">{made?.toLocaleString()} made</span>;
    if (kept === 0) {
        return (
            <div className="min-w-0">
                <p className="text-muted-foreground">none kept</p>
                {made !== null && <p className="text-xs text-muted-foreground tabular-nums">{made > 0 ? `${made.toLocaleString()} made, all removed` : "none made"}</p>}
            </div>
        );
    }
    return (
        <div className="min-w-0">
            <p className="tabular-nums">
                <span className="font-medium">{kept.toLocaleString()} kept</span>
                {made !== null && <span className="text-xs text-muted-foreground"> of {made.toLocaleString()} made</span>}
            </p>
            <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-foreground/80" style={{ width: `${Math.max(most > 0 ? kept / most : 0, 0.03) * 100}%` }} />
            </div>
        </div>
    );
}

/**
 * The versions a server ran, newest first: when each came and from which, how long it ran, and the
 * backups made while it ran with how many are still kept. It comes a page at a time, so a server
 * with a long history loads only what shows.
 */
export function ServerVersions({ serverId }: { serverId: string }) {
    const [page, setPage] = useState(1);
    const loaded = useDatabaseData<VersionPage>(`/api/databases/servers/${encodeURIComponent(serverId)}/versions?page=${page}&size=${SIZE}`, "The versions could not be loaded.");
    const data = loaded.data;
    const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
    const most = Math.max(0, ...(data?.versions ?? []).map((period) => period.kept ?? 0));
    const first = (page - 1) * SIZE + 1;
    const now = Date.now();

    return (
        <section aria-label="Versions" className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
            <div className="px-5 pt-4 pb-3">
                <h3 className="font-semibold">Versions</h3>
                <p className="text-sm text-muted-foreground">{data ? `${count(data.total, "version")}, newest first` : " "}</p>
            </div>
            {loaded.loading ? (
                <div className="space-y-2 border-t px-5 py-4" aria-busy="true">
                    {Array.from({ length: SIZE }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
                </div>
            ) : !data ? (
                <p className="border-t px-5 py-6 text-sm text-muted-foreground">{loaded.error ?? "The versions could not be loaded."}</p>
            ) : data.versions.length === 0 ? (
                <p className="border-t px-5 py-6 text-center text-sm text-muted-foreground">The hourly check has not read a version of this server yet.</p>
            ) : (
                <Table>
                    <TableHeader className="border-t bg-muted/40">
                        <TableRow className="hover:bg-transparent">
                            <TableHead className="pl-5">Version</TableHead>
                            <TableHead>Since</TableHead>
                            <TableHead>Until</TableHead>
                            <TableHead>On it</TableHead>
                            <TableHead className="pr-5">Backups</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.versions.map((period, index) => (
                            <TableRow key={`${period.version}-${period.since ?? index}`} className={cn("hover:bg-transparent", period.change?.kind === "down" && "bg-warning/5 hover:bg-warning/5")}>
                                <TableCell className="py-2.5 pl-5">
                                    <span className="flex items-center gap-2">
                                        <span className="font-semibold tabular-nums">{period.version}</span>
                                        {period.until === null && <span className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium">Now</span>}
                                    </span>
                                    <Change change={period.change} />
                                </TableCell>
                                <TableCell className="tabular-nums">{period.since ? <DateDisplay date={period.since} format="Pp" /> : <span className="text-muted-foreground">before the history</span>}</TableCell>
                                <TableCell className="tabular-nums">{period.until ? <DateDisplay date={period.until} format="P" /> : <span className="text-muted-foreground">today</span>}</TableCell>
                                <TableCell className="text-muted-foreground">{timeOn(period.since, period.until, now) ?? "-"}</TableCell>
                                <TableCell className="pr-5"><Backups period={period} most={most} /></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
            {data && data.total > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-sm text-muted-foreground">
                    <span className="tabular-nums">{first.toLocaleString()} to {Math.min(page * SIZE, data.total).toLocaleString()} of {count(data.total, "version")}</span>
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground tabular-nums">Page {page} of {pages}</span>
                        <Button variant="outline" size="icon" className="size-8" aria-label="Newer versions" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
                            <ChevronLeft />
                        </Button>
                        <Button variant="outline" size="icon" className="size-8" aria-label="Older versions" onClick={() => setPage((value) => Math.min(pages, value + 1))} disabled={page >= pages}>
                            <ChevronRight />
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}
