"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, Database } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import type { TimelineFormat } from "@/components/dashboard/storage/explorer/timeline-cells";
import type { DayKey } from "@/components/dashboard/storage/explorer/timeline-model";
import { cn } from "@/lib/utils";
import type { ExplorerDbJob } from "@/services/databases/database-explorer-types";
import { engineOf } from "./database-columns";
import { databaseHref, type TimelineDatabaseRow, type TimelineGroup } from "./database-model";
import { Cell, VersionMark } from "./database-timeline-parts";

/** A database, or a folded server by `server:` and its id, and a day of it. */
export interface TimelinePick {
    key: string;
    day: DayKey;
}

/** The key a folded server is picked by, beside the keys of its databases. */
export const serverPickKey = (serverId: string) => `server:${serverId}`;

interface ServerGroupProps {
    group: TimelineGroup;
    /** The rows of the server on this page, empty while it is folded. */
    rows: TimelineDatabaseRow[];
    folded: boolean;
    onFold: (folded: boolean) => void;
    days: DayKey[];
    template: React.CSSProperties;
    jobsById: Map<string, ExplorerDbJob>;
    format: TimelineFormat;
    picked: TimelinePick | null;
    onPick: (key: string, day: DayKey) => void;
}

/**
 * A server and its databases on the days of the timeline. Its head names it on two lines and
 * marks new versions in the columns of their days. Folded, the head carries every run of the
 * server instead of its rows.
 */
export function ServerGroup({ group, rows, folded, onFold, days, template, jobsById, format, picked, onPick }: ServerGroupProps) {
    const { server, marks } = group;
    const total = group.rows.length;
    const covered = group.rows.filter((row) => row.database.jobIds.length > 0).length;
    const serverKey = serverPickKey(server.id);
    const sub = folded
        ? `${engineOf(server)} · ${count(total, "database")}, ${covered === total ? "all in a job" : `${covered} in a job`}`
        : `${engineOf(server)} · ${covered} of ${total} in a job`;

    return (
        <div role="group" aria-label={server.name}>
            <div className="grid items-center border-b bg-foreground/[0.025] px-5 py-1.5" style={template}>
                <div className="flex min-w-0 items-center gap-2 pr-3">
                    <button
                        type="button"
                        onClick={() => onFold(!folded)}
                        aria-expanded={!folded}
                        aria-label={`${folded ? "Unfold" : "Fold"} ${server.name}`}
                        className="-ml-1.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        {folded ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                    </button>
                    <AdapterIcon adapterId={server.adapterId} className="size-4 shrink-0" />
                    <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{server.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
                    </span>
                </div>
                {folded
                    ? group.cells.map((cell) => (
                        <Cell
                            key={cell.day}
                            cell={cell}
                            name={server.name}
                            changes={marks.get(cell.day)}
                            jobsById={jobsById}
                            format={format}
                            picked={picked?.key === serverKey && picked.day === cell.day}
                            onPick={() => onPick(serverKey, cell.day)}
                        />
                    ))
                    : days.map((day) => (
                        <span key={day} className="flex min-w-0 justify-center">
                            {marks.has(day) && <VersionMark changes={marks.get(day) ?? []} format={format} />}
                        </span>
                    ))}
            </div>
            {!folded && rows.length > 0 && (
                <div className="relative">
                    {marks.size > 0 && (
                        // A dashed line down through the databases of the server on the day it changed.
                        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid px-5" style={template}>
                            <span />
                            {days.map((day) => <span key={day} className={cn(marks.has(day) && "border-l border-dashed border-foreground/40")} />)}
                        </div>
                    )}
                    {rows.map(({ database, cells }) => {
                        const names = database.jobIds.map((id) => jobsById.get(id)?.name ?? "A deleted job");
                        return (
                            <div key={database.key} className="relative grid items-center border-b px-5 py-1.5" style={template}>
                                <Link
                                    href={databaseHref(database)}
                                    className="flex min-w-0 items-center gap-2.5 rounded-md pr-3 pl-6 text-left outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                                >
                                    <Database className={cn("size-4 shrink-0", names.length === 0 ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium">{database.name}</span>
                                        <span className={cn("block truncate text-xs", names.length === 0 ? "text-warning" : "text-muted-foreground")}>
                                            {names.length === 0 ? "In no job" : names.join(", ")}
                                        </span>
                                    </span>
                                </Link>
                                {cells.map((cell) => (
                                    <Cell
                                        key={cell.day}
                                        cell={cell}
                                        name={database.name}
                                        jobsById={jobsById}
                                        format={format}
                                        picked={picked?.key === database.key && picked.day === cell.day}
                                        onPick={() => onPick(database.key, cell.day)}
                                    />
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
