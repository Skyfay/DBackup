"use client";

import Link from "next/link";
import { ArrowRight, ChevronRight, Database } from "lucide-react";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerDatabase, ExplorerDbJob, ExplorerServer } from "@/services/databases/database-explorer-types";
import { JobsCell } from "./database-columns";
import { compactCount, databaseHref } from "./database-model";

/** How many databases the card shows, the rest are a click away on the Databases tab. */
const SHOWN = 10;

const ROW = "flex min-w-0 items-center gap-3 border-t px-5 py-2.5 outline-none hover:bg-muted/50 focus-visible:bg-muted/50";

interface ServerDatabasesProps {
    server: ExplorerServer;
    databases: ExplorerDatabase[];
    jobsById: Map<string, ExplorerDbJob>;
    /** Whether the viewer may see jobs, which the jobs of each database need. */
    coverage: boolean;
}

/**
 * The databases of a server, biggest first, each with the jobs that back it up and a click to its
 * page. A Redis or Valkey server lists its numbered databases with their keys instead.
 */
export function ServerDatabases({ server, databases, jobsById, coverage }: ServerDatabasesProps) {
    const instance = databases.find((database) => database.kind === "instance") ?? null;
    const sorted = [...databases].sort((a, b) => (b.sizeInBytes ?? -1) - (a.sizeInBytes ?? -1) || a.name.localeCompare(b.name));
    const biggest = Math.max(0, ...databases.map((database) => database.sizeInBytes ?? 0));
    const covered = databases.filter((database) => database.jobIds.length > 0).length;
    const sub = instance
        ? `${count(instance.logical.length + instance.emptyLogical, "database")}, ${instance.logical.length} with keys`
        : `${count(databases.length, "database")}${coverage ? `, ${covered} in a job` : ""}, biggest first`;

    return (
        <section aria-label="Databases" className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
            <div className="flex items-start gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">Databases</h3>
                    <p className="truncate text-sm text-muted-foreground">{sub}</p>
                </div>
                {!instance && databases.length > 0 && (
                    <Link
                        href={`/dashboard/explorer?sourceId=${encodeURIComponent(server.id)}`}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-sm text-sm font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        All {databases.length.toLocaleString()} in Databases
                    </Link>
                )}
            </div>

            {instance ? (
                <ul>
                    {instance.logical.map((entry) => (
                        <li key={entry.name}>
                            <Link href={databaseHref(instance, { table: entry.name })} className={ROW}>
                                <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">db{entry.name}</span>
                                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{compactCount(entry.keys)} keys</span>
                                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            </Link>
                        </li>
                    ))}
                    {instance.emptyLogical > 0 && <li className="border-t px-5 py-2.5 text-sm text-muted-foreground">{count(instance.emptyLogical, "empty database")}</li>}
                </ul>
            ) : databases.length === 0 ? (
                <p className="border-t px-5 py-6 text-center text-sm text-muted-foreground">DBackup has not read any database of {server.name} yet.</p>
            ) : (
                <ul>
                    {sorted.slice(0, SHOWN).map((database) => {
                        const noJob = coverage && database.jobIds.length === 0;
                        return (
                            <li key={database.key}>
                                <Link href={databaseHref(database)} className={ROW}>
                                    <Database className={cn("size-4 shrink-0", noJob ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{database.name}</span>
                                    <span className="w-24 shrink-0">
                                        {database.sizeInBytes === null ? (
                                            <span className="text-xs text-muted-foreground">no size</span>
                                        ) : (
                                            <>
                                                <span className="block text-xs tabular-nums">{formatBytes(database.sizeInBytes)}</span>
                                                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                                                    <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${Math.max(biggest > 0 ? database.sizeInBytes / biggest : 0, 0.03) * 100}%` }} />
                                                </span>
                                            </>
                                        )}
                                    </span>
                                    {coverage && (
                                        <span className="hidden w-52 shrink-0 sm:block">
                                            <JobsCell jobIds={database.jobIds} jobsById={jobsById} />
                                        </span>
                                    )}
                                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                </Link>
                            </li>
                        );
                    })}
                    {databases.length > SHOWN && (
                        <li className="border-t px-5 py-2.5 text-sm text-muted-foreground">and {count(databases.length - SHOWN, "more database")}</li>
                    )}
                </ul>
            )}
        </section>
    );
}
