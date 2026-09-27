"use client";

import { useState } from "react";
import { ChevronRight, Database } from "lucide-react";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { cn } from "@/lib/utils";
import type { ExplorerDatabase } from "@/services/databases/database-explorer-types";
import { compactCount, emptyLogicalNames, foldedNames } from "./database-model";
import { PANE, PaneHead, PaneRow, PaneScroll, PaneSearch } from "./database-pane";

interface InstanceDatabasesProps {
    /** A Redis or Valkey server as one entry. */
    database: ExplorerDatabase;
    picked: string | null;
    onPick: (name: string) => void;
    reading: boolean;
    /** Counts the keys again, which reads the server now. */
    onRead: () => void;
}

/**
 * The numbered databases of a Redis or Valkey server with their keys, the ones without a key
 * folded into one line at the end. A click reads the keys of one beside.
 */
export function InstanceDatabases({ database, picked, onPick, reading, onRead }: InstanceDatabasesProps) {
    const empty = emptyLogicalNames(database);
    const [search, setSearch] = useState("");
    const [unfolded, setUnfolded] = useState(() => picked !== null && empty.includes(picked));
    const total = database.logical.length + empty.length;
    const term = search.trim().toLowerCase();
    const matches = (name: string) => !term || `db${name}`.includes(term);
    const held = database.logical.filter((entry) => matches(entry.name));
    // A search looks through the empty ones too.
    const shownEmpty = unfolded || term ? empty.filter(matches) : [];

    return (
        <div className={PANE}>
            <PaneHead
                title="Databases"
                sub={empty.length > 0 && database.logical.length > 0 ? `${total}, the empty ones folded` : count(total, "database")}
                refreshLabel="Count the keys again"
                busy={reading}
                onRefresh={onRead}
            />
            <PaneSearch value={search} onChange={setSearch} placeholder="Search databases" />
            <PaneScroll>
                <ul className="space-y-0.5 px-2 pb-2">
                    {held.map((entry) => (
                        <PaneRow
                            key={entry.name}
                            icon={Database}
                            name={`db${entry.name}`}
                            sub={count(entry.keys, "key")}
                            aside={<span className="shrink-0 text-xs tabular-nums">{compactCount(entry.keys)}</span>}
                            picked={picked === entry.name}
                            onPick={() => onPick(entry.name)}
                        />
                    ))}
                    {empty.length > 0 && !term && (
                        <li className={cn(database.logical.length > 0 && "mt-1 border-t pt-1")}>
                            <button
                                type="button"
                                onClick={() => setUnfolded((value) => !value)}
                                aria-expanded={unfolded}
                                className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                                <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", unfolded && "rotate-90")} aria-hidden="true" />
                                <span className="shrink-0">{count(empty.length, "empty database")}</span>
                                <span className="ml-auto min-w-0 truncate">{foldedNames(empty)}</span>
                            </button>
                        </li>
                    )}
                    {shownEmpty.map((name) => (
                        <PaneRow key={name} icon={Database} name={`db${name}`} sub="No key when last counted" picked={picked === name} onPick={() => onPick(name)} />
                    ))}
                    {held.length === 0 && shownEmpty.length === 0 && term && <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">No database matches the search.</li>}
                </ul>
            </PaneScroll>
        </div>
    );
}
