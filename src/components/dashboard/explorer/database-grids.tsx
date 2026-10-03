"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import type { ColumnInfo } from "@/lib/core/interfaces";
import { cn } from "@/lib/utils";
import { PaneScroll } from "./database-pane";
import type { RowSort } from "./database-rows-parts";

/** A head cell that stays on top while the rows scroll under it, with the line under it drawn inside. */
const HEAD = "sticky top-0 z-10 bg-muted shadow-[inset_0_-1px_0_var(--border)]";

/**
 * A grid of a pane that scrolls both ways inside it. The table sits in the scroll area itself,
 * not in the `Table` of `ui/table`, whose own box would scroll sideways and keep the head from
 * sticking.
 */
function Grid({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
    return (
        <PaneScroll horizontal className="rounded-lg border">
            <table className="w-full caption-bottom text-sm">
                <thead>
                    <tr>{head}</tr>
                </thead>
                <TableBody>{children}</TableBody>
            </table>
        </PaneScroll>
    );
}

function cellText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 120)}…` : value;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

/** The rows of a table, with a click on a head sorting by that column. */
export function RowsGrid({ columns, rows, sort, onSort }: {
    columns: ColumnInfo[];
    rows: Record<string, unknown>[];
    sort: RowSort | null;
    onSort: (column: string) => void;
}) {
    return (
        <Grid
            head={columns.map((column) => {
                const sorted = sort?.column === column.name ? sort.dir : null;
                const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
                return (
                    <TableHead key={column.name} className={HEAD}>
                        <button
                            type="button"
                            onClick={() => onSort(column.name)}
                            className="flex items-center gap-1.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            {column.primaryKey && <span className="text-[10px] font-bold text-warning" title="Primary key">PK</span>}
                            <span className="font-medium text-foreground">{column.name}</span>
                            <span className="text-xs font-normal text-muted-foreground">{column.dataType}</span>
                            <SortIcon className={cn("size-3 shrink-0", !sorted && "opacity-40")} aria-hidden="true" />
                        </button>
                    </TableHead>
                );
            })}
        >
            {rows.map((row, index) => (
                <TableRow key={index}>
                    {columns.map((column) => {
                        const value = row[column.name];
                        const empty = value === null || value === undefined;
                        return (
                            <TableCell key={column.name} className="max-w-xs truncate font-mono text-xs" title={empty ? "NULL" : cellText(value)}>
                                {empty ? <span className="text-muted-foreground/60 italic">NULL</span> : cellText(value)}
                            </TableCell>
                        );
                    })}
                </TableRow>
            ))}
        </Grid>
    );
}

/** The keys of a Redis database with their type and time to live. */
export function RedisKeys({ rows }: { rows: Record<string, unknown>[] }) {
    return (
        <Grid
            head={(
                <>
                    <TableHead className={HEAD}>Key</TableHead>
                    <TableHead className={cn(HEAD, "w-28")}>Type</TableHead>
                    <TableHead className={cn(HEAD, "w-28 text-right")}>Time to live</TableHead>
                </>
            )}
        >
            {rows.map((row, index) => (
                <TableRow key={index}>
                    <TableCell className="max-w-md truncate font-mono text-xs">{String(row.key ?? "")}</TableCell>
                    <TableCell><span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">{String(row.type ?? "unknown")}</span></TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{String(row.ttl ?? "-")}</TableCell>
                </TableRow>
            ))}
        </Grid>
    );
}

/** The columns of a table as the server describes them, or the fields found in the documents of a collection. */
export function SchemaTable({ columns }: { columns: ColumnInfo[] }) {
    const [search, setSearch] = useState("");
    const term = search.trim().toLowerCase();
    const shown = term ? columns.filter((column) => column.name.toLowerCase().includes(term) || column.dataType.toLowerCase().includes(term)) : columns;
    return (
        <>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search columns" aria-label="Search columns" className="h-8 max-w-64" />
            <Grid
                head={(
                    <>
                        <TableHead className={HEAD}>Column</TableHead>
                        <TableHead className={HEAD}>Type</TableHead>
                        <TableHead className={cn(HEAD, "w-24")}>Nullable</TableHead>
                        <TableHead className={HEAD}>Default</TableHead>
                    </>
                )}
            >
                {shown.map((column) => (
                    <TableRow key={column.name}>
                        <TableCell className="font-mono text-xs">
                            <span className="inline-flex items-center gap-1.5">
                                {column.name}
                                {column.primaryKey && <span className="text-[10px] font-bold text-warning">PK</span>}
                            </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{column.dataType}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{column.nullable === undefined ? "-" : column.nullable ? "Yes" : "No"}</TableCell>
                        <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">{column.defaultValue ?? "-"}</TableCell>
                    </TableRow>
                ))}
                {shown.length === 0 && (
                    <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No column matches the search.</TableCell>
                    </TableRow>
                )}
            </Grid>
        </>
    );
}
