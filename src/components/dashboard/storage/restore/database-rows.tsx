"use client";

import { useMemo, useState } from "react";
import { Download, Layers, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { QuickFilter, type QuickFilterOption } from "@/components/ui/quick-filter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatBytes } from "@/lib/utils";
import { filterCounts, matchesFilter, type DbFilter, type DbRow } from "./restore-model";
import { FlowArrow, OutcomeTag } from "./restore-parts";

// A phone gets the name, the tag and the new name below. From md on every part has its column.
const GRID = "grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 md:grid-cols-[1rem_minmax(0,1fr)_3.25rem_minmax(0,1.3fr)_9.5rem_5.5rem_2rem]";

function Outcome({ row }: { row: DbRow }) {
    if (row.outcome === "overwrite") return <OutcomeTag tone="warning" icon="alert">Overwrites{row.thereSize !== null ? ` ${formatBytes(row.thereSize)}` : ""}</OutcomeTag>;
    if (row.outcome === "new") return <OutcomeTag tone="success" icon="plus">New</OutcomeTag>;
    if (row.outcome === "unverified") {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span tabIndex={0} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                        <OutcomeTag tone="muted" icon="help">Not checked</OutcomeTag>
                    </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-72">Firebird cannot list its databases, so DBackup cannot see what lies at this path. A file there is overwritten.</TooltipContent>
            </Tooltip>
        );
    }
    return <span className="text-xs text-muted-foreground">{row.outcome === "out" ? "stays out" : "stays as it is"}</span>;
}

interface RowProps {
    row: DbRow;
    canDownload: boolean;
    onPick: (ids: string[], picked: boolean) => void;
    onRename: (id: string, name: string) => void;
    onDownload: (name: string) => void;
}

function Row({ row, canDownload, onPick, onRename, onDownload }: RowProps) {
    const source = row.source;
    const tone = row.outcome === "overwrite" ? "warning" : row.outcome === "new" ? "success" : row.outcome === "unverified" ? "muted" : null;
    return (
        <div className={cn(GRID, "px-4 py-2.5", source !== null && !row.picked && "text-muted-foreground")}>
            {source !== null ? <Checkbox checked={row.picked} onCheckedChange={(on) => onPick([row.id], on === true)} aria-label={`Restore ${source}`} /> : <span />}
            <div className="min-w-0">
                <p className={cn("truncate text-sm font-medium", source === null && "font-normal text-muted-foreground")}>{source ?? "Only on the server"}</p>
                {row.size !== null && <p className="text-xs text-muted-foreground tabular-nums">{formatBytes(row.size)} in the backup</p>}
            </div>
            <span className="hidden md:block">
                <FlowArrow tone={row.picked ? tone : null} />
            </span>
            <div className="col-span-2 col-start-2 row-start-2 min-w-0 md:col-span-1 md:col-start-auto md:row-start-auto">
                {source !== null ? (
                    <Input value={row.target} onChange={(event) => onRename(row.id, event.target.value)} disabled={!row.picked} className="h-8" aria-label={`Name of ${source} on the server`} />
                ) : (
                    <p className="truncate text-sm">{row.target}</p>
                )}
            </div>
            <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                <Outcome row={row} />
            </div>
            <span className="hidden text-right text-xs text-muted-foreground tabular-nums md:block">
                {row.thereSize !== null ? formatBytes(row.thereSize) : row.outcome === "stays" ? "-" : "not there"}
            </span>
            <span className="hidden md:block">
                {canDownload && source !== null && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" onClick={() => onDownload(source)} aria-label={`Download ${source} as a dump`}>
                                <Download />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Download it as a dump</TooltipContent>
                    </Tooltip>
                )}
            </span>
        </div>
    );
}

interface DatabaseRowsProps {
    rows: DbRow[];
    serverName: string | null;
    canDownload: boolean;
    filter: DbFilter;
    onFilter: (filter: DbFilter) => void;
    /** The switch to the lines, at the end of the toolbar. */
    toolbarEnd?: React.ReactNode;
    onPick: (ids: string[], picked: boolean) => void;
    onRename: (id: string, name: string) => void;
    onCopies: (ids: string[]) => void;
    onOwnNames: (ids: string[]) => void;
    onDownload: (name: string) => void;
}

/**
 * The databases of the backup row by row beside what the server has, like a diff: the name each
 * one gets there, and what happens, overwritten or new. The databases only the server has stay
 * at the end. A filter and the search narrow it, and a copy beside the ones there is one click.
 */
export function DatabaseRows(props: DatabaseRowsProps) {
    const { rows, serverName, canDownload, filter, onFilter, toolbarEnd, onPick, onRename, onCopies, onOwnNames, onDownload } = props;
    const [search, setSearch] = useState("");
    const term = search.trim().toLowerCase();
    const counts = useMemo(() => filterCounts(rows), [rows]);
    const shown = rows.filter((row) => matchesFilter(row, filter) && (!term || (row.source ?? "").toLowerCase().includes(term) || row.target.toLowerCase().includes(term)));
    const shownBackup = shown.filter((row) => row.source !== null);
    const allPicked = shownBackup.length > 0 && shownBackup.every((row) => row.picked);
    const overwriting = shownBackup.filter((row) => row.picked && row.outcome === "overwrite");
    const renamed = shownBackup.filter((row) => row.source !== row.target);
    const backupRows = rows.filter((row) => row.source !== null);
    const picked = backupRows.filter((row) => row.picked);
    const pickedBytes = picked.reduce((sum, row) => sum + (row.size ?? 0), 0);
    const server = serverName ?? "the server";

    const options: QuickFilterOption<DbFilter>[] = [
        { value: "all" as const, label: "All", count: counts.all },
        { value: "overwrite" as const, label: "Overwritten", count: counts.overwrite, dot: "bg-warning" },
        { value: "new" as const, label: "New", count: counts.new, dot: "bg-success" },
        { value: "stays" as const, label: "Stays", count: counts.stays },
        { value: "out" as const, label: "Left out", count: counts.out },
    ].filter((option) => option.value === "all" || option.value === filter || option.count > 0);

    return (
        <div className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-2 p-3 md:px-4">
                <div className="relative w-full sm:w-60">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search databases" className="h-8 pl-8" aria-label="Search databases" />
                </div>
                <QuickFilter value={filter} onChange={onFilter} options={options} aria-label="Show" />
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    {overwriting.length > 0 && (
                        <Button variant="outline" size="sm" onClick={() => onCopies(overwriting.map((row) => row.id))} title="They come back beside the ones there, under a free name like shop_restored">
                            <Layers />
                            {overwriting.length === 1 ? "Restore as a copy" : `Restore ${overwriting.length} as copies`}
                        </Button>
                    )}
                    {renamed.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => onOwnNames(renamed.map((row) => row.id))}>
                            <RotateCcw />
                            Own names
                        </Button>
                    )}
                    {toolbarEnd}
                </div>
            </div>
            <div className={cn(GRID, "hidden border-y bg-muted/40 px-4 py-2 text-xs text-muted-foreground md:grid")}>
                <Checkbox
                    checked={allPicked ? true : shownBackup.some((row) => row.picked) ? "indeterminate" : false}
                    onCheckedChange={() => onPick(shownBackup.map((row) => row.id), !allPicked)}
                    disabled={shownBackup.length === 0}
                    aria-label="Pick every database shown"
                />
                <span>In the backup</span>
                <span />
                <span className="truncate">On {server} afterwards</span>
                <span />
                <span className="text-right">There now</span>
                <span />
            </div>
            <div className="divide-y">
                {shown.map((row) => (
                    <Row key={row.id} row={row} canDownload={canDownload} onPick={onPick} onRename={onRename} onDownload={onDownload} />
                ))}
                {shown.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing matches.</p>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
                <span className="tabular-nums">
                    {picked.length} of {backupRows.length} picked{pickedBytes > 0 ? ` · ${formatBytes(pickedBytes)}` : ""}
                </span>
                {counts.stays > 0 && (
                    <span className="sm:ml-auto">
                        {counts.stays} other{counts.stays === 1 ? "" : "s"} on {server} stay as they are
                    </span>
                )}
            </div>
        </div>
    );
}
