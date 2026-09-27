"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, Layers, Table2 } from "lucide-react";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { Skeleton } from "@/components/ui/skeleton";
import type { TableInfo } from "@/lib/core/interfaces";
import { formatBytes } from "@/lib/utils";
import { ClosedNote, PANE, PaneHead, PaneRow, PaneScroll, PaneSearch } from "./database-pane";

const ICONS = { table: Table2, view: Eye, materialized_view: Eye, collection: Layers } as const;

interface TablesState {
    key: string;
    tables: TableInfo[] | null;
    error: string | null;
}

interface DatabaseTablesProps {
    sourceId: string;
    database: string;
    serverName: string;
    picked: string | null;
    onPick: (table: string) => void;
}

/** The tables of a database, biggest first, with a search. A click shows the rows of one beside. */
export function DatabaseTables({ sourceId, database, serverName, picked, onPick }: DatabaseTablesProps) {
    const key = `${sourceId}/${database}`;
    const [state, setState] = useState<TablesState | null>(null);
    const [version, setVersion] = useState(0);
    const [search, setSearch] = useState("");

    useEffect(() => {
        let ignore = false;
        fetch("/api/adapters/database-tables", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceId, database }),
        })
            .then((res) => res.json().catch(() => null))
            .then((payload) => {
                if (ignore) return;
                if (payload?.success && Array.isArray(payload.tables)) setState({ key, tables: payload.tables as TableInfo[], error: null });
                else setState({ key, tables: null, error: payload?.message ?? payload?.error ?? "The server did not list the tables." });
            })
            .catch(() => {
                if (!ignore) setState({ key, tables: null, error: "The server could not be reached." });
            });
        return () => {
            ignore = true;
        };
    }, [key, sourceId, database, version]);

    const current = state?.key === key ? state : null;
    const tables = useMemo(() => current?.tables ?? [], [current]);
    const sorted = useMemo(() => {
        const sized = tables.some((table) => table.sizeInBytes !== undefined);
        return [...tables].sort((a, b) => (sized ? (b.sizeInBytes ?? -1) - (a.sizeInBytes ?? -1) : a.name.localeCompare(b.name)));
    }, [tables]);
    const term = search.trim().toLowerCase();
    const shown = term ? sorted.filter((table) => table.name.toLowerCase().includes(term)) : sorted;
    const biggest = Math.max(...tables.map((table) => table.sizeInBytes ?? 0), 1);
    const views = tables.filter((table) => table.type === "view" || table.type === "materialized_view").length;
    const sized = tables.some((table) => table.sizeInBytes !== undefined);
    const sub = !current
        ? " "
        : current.error
            ? "Not listed"
            : `${views > 0 ? `${count(tables.length - views, "table")} and ${count(views, "view")}` : count(tables.length, "table")}${sized ? ", biggest first" : ""}`;

    return (
        <div className={PANE}>
            <PaneHead title="Tables" sub={sub} refreshLabel="List the tables again" busy={!current} onRefresh={() => setVersion((value) => value + 1)} />
            {!current ? (
                <div className="space-y-2 px-4 pb-4" aria-busy="true">
                    {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}
                </div>
            ) : current.error ? (
                <div className="px-4 pb-4">
                    <ClosedNote title="The tables could not be listed" message={current.error}>
                        The login of {serverName} may not look inside {database}. Its backups do not depend on it.
                    </ClosedNote>
                </div>
            ) : tables.length === 0 ? (
                <div className="px-4 pb-4">
                    <ClosedNote title="No tables">
                        {database} has none the login of {serverName} can see. If it is not empty, the login may lack the rights to look inside.
                    </ClosedNote>
                </div>
            ) : (
                <>
                    <PaneSearch value={search} onChange={setSearch} placeholder="Search tables" />
                    <PaneScroll>
                        <ul className="space-y-0.5 px-2 pb-2">
                            {shown.map((table) => (
                                <PaneRow
                                    key={table.name}
                                    icon={ICONS[table.type ?? "table"] ?? Table2}
                                    name={table.name}
                                    sub={table.rowCount !== undefined ? `${table.rowCount.toLocaleString()} ${table.type === "collection" ? "documents" : "rows"}` : table.type === "view" ? "View" : ""}
                                    aside={table.sizeInBytes !== undefined && (
                                        <span className="w-20 shrink-0 text-right">
                                            <span className="block text-xs tabular-nums">{formatBytes(table.sizeInBytes)}</span>
                                            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                                                <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${Math.max(table.sizeInBytes / biggest, 0.03) * 100}%` }} />
                                            </span>
                                        </span>
                                    )}
                                    picked={picked === table.name}
                                    onPick={() => onPick(table.name)}
                                />
                            ))}
                            {shown.length === 0 && <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">No table matches the search.</li>}
                        </ul>
                    </PaneScroll>
                </>
            )}
        </div>
    );
}
