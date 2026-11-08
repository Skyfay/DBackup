"use client";

import { useState } from "react";
import { Database, Loader2, MoreHorizontal, Play, Search } from "lucide-react";
import { sharedKey } from "@/components/dashboard/shared/shared-model";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { QuickFilter } from "@/components/ui/quick-filter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { formatBytes } from "@/lib/utils";
import type { ProvidedDatabase, SharedServerTerms } from "@/services/sharing/shared-server-rows";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import { backUpReady, sharedDatabaseMenu, type SharedDatabaseHandlers, type SharedServerAccess } from "./shared-server-actions";
import { DropdownEntries } from "./shared-server-menus";
import { RunBadge, RUNNING_DOT } from "./shared-database-status";

/** From how many databases on the server the list gets a search and the filter of the running ones. */
export const SEARCH_FROM = 7;

type DatabaseFilter = "all" | "running";

const isRunning = (entry: ProvidedDatabase) => Boolean(entry.database.onDemand?.active);

/** The databases a search and the filter leave, by the start of a word of the name or anywhere in it. */
export function filterDatabases(entries: readonly ProvidedDatabase[], query: string, filter: DatabaseFilter): ProvidedDatabase[] {
    const text = query.trim().toLowerCase();
    return entries.filter((entry) => (filter === "all" || isRunning(entry)) && (!text || entry.database.databaseName.toLowerCase().includes(text)));
}

/** "2 of 4 left today", "1 of 4 used today" while one runs, or "none allowed". */
function todayLine(database: SharedDatabase): string {
    const onDemand = database.onDemand;
    if (!onDemand) return "none allowed";
    if (onDemand.active) return `${onDemand.usedToday} of ${onDemand.perDay} used today`;
    return `${Math.max(0, onDemand.perDay - onDemand.usedToday)} of ${onDemand.perDay} left today`;
}

interface DatabaseLineProps {
    entry: ProvidedDatabase;
    access: SharedServerAccess;
    starting: string | null;
    onBackUp: (database: SharedDatabase) => void;
    handlers: SharedDatabaseHandlers;
}

/** One database of the server: since when it is the tenant's, its newest dump, its last backup, Back up now and its menu. */
function DatabaseLine({ entry, access, starting, onBackUp, handlers }: DatabaseLineProps) {
    const { formatDate } = useDateFormatter();
    const { database, newest } = entry;
    const active = database.onDemand?.active;
    const menu = sharedDatabaseMenu(entry, access, handlers);
    return (
        <li className="flex min-w-0 items-center gap-3 px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                <Database className="size-4 text-muted-foreground" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={database.databaseName}>{database.databaseName}</span>
                <span className="block truncate text-xs text-muted-foreground tabular-nums">
                    yours since {formatDate(database.since, "PP")}{newest?.dump && ` · ${formatBytes(newest.dump.stored, 1)}`}
                </span>
            </span>
            <span className="hidden w-32 shrink-0 sm:block">
                <span className="block truncate text-sm">{entry.lastBackup ? <RelativeTime date={entry.lastBackup.at} /> : "No backup yet"}</span>
                <span className="block truncate text-xs text-muted-foreground tabular-nums">{todayLine(database)}</span>
            </span>
            {active ? (
                <RunBadge active={active} />
            ) : access.canBackUp && database.onDemand ? (
                <Button variant="outline" size="sm" onClick={() => onBackUp(database)} disabled={!backUpReady(database, starting)}>
                    {starting === sharedKey(database) ? <Loader2 className="animate-spin" /> : <Play />}
                    Back up now
                </Button>
            ) : access.canBackUp ? (
                <span className="shrink-0 text-xs text-muted-foreground">Back up now off</span>
            ) : null}
            {/* A line without a menu keeps its place, so the buttons of every line stand in one column. */}
            {menu.length === 0 && <span className="size-8 shrink-0" aria-hidden="true" />}
            {menu.length > 0 && (
                <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="size-8 p-0">
                            <MoreHorizontal />
                            <span className="sr-only">Open menu for {database.databaseName}</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                        <DropdownEntries groups={[{ entries: menu }]} />
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </li>
    );
}

interface SharedServerDatabasesProps extends Omit<DatabaseLineProps, "entry"> {
    terms: SharedServerTerms;
}

/**
 * The databases of a provided server the tenant holds, each with its own backups and Back up now.
 * A long list gets a search and the filter of the running ones, and scrolls on its own.
 */
export function SharedServerDatabases({ terms, ...line }: SharedServerDatabasesProps) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<DatabaseFilter>("all");
    const many = terms.databases.length >= SEARCH_FROM;
    const shown = many ? filterDatabases(terms.databases, query, filter) : terms.databases;
    const running = terms.databases.filter(isRunning).length;
    const list = (
        <ul className="divide-y">
            {shown.map((entry) => <DatabaseLine key={entry.database.databaseName} entry={entry} {...line} />)}
            {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No database matches.</li>}
        </ul>
    );

    return (
        <div className="space-y-2.5">
            {many && (
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={`Search your ${terms.databases.length.toLocaleString()} databases`}
                            aria-label="Search your databases"
                            className="h-8 pl-8"
                        />
                    </div>
                    <QuickFilter
                        aria-label="Filter the databases"
                        value={filter}
                        onChange={setFilter}
                        options={[
                            { value: "all", label: "All", count: terms.databases.length },
                            { value: "running", label: "Running", count: running, dot: RUNNING_DOT },
                        ]}
                    />
                </div>
            )}
            <div className="overflow-hidden rounded-lg border">
                {many ? <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[28rem]">{list}</ScrollArea> : list}
            </div>
        </div>
    );
}
