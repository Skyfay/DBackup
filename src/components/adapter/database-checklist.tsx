"use client";

import { useId, useState } from "react";
import { ArrowUpDown, Info, RotateCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatBytes } from "@/lib/utils";
import { useDatabaseListing, type DatabaseStats } from "./use-database-listing";

type Sort = "name" | "size";

interface DatabaseChecklistProps {
    sourceId: string;
    value: string[];
    onChange: (names: string[]) => void;
    /** Switches to all databases. Offered once every one is picked, since all also takes the ones added later. */
    onUseAll?: () => void;
}

/**
 * The databases on the server of a source to pick from: a search, a checkbox for all of them, the
 * size and tables of each, and below how many are picked and how big they are together.
 */
export function DatabaseChecklist(props: DatabaseChecklistProps) {
    // Another source starts over, with its own list and without the search of the last one.
    return <Checklist key={props.sourceId} {...props} />;
}

function Highlight({ text, term }: { text: string; term: string }) {
    const at = term ? text.toLowerCase().indexOf(term) : -1;
    if (at < 0) return <>{text}</>;
    return (
        <>
            {text.slice(0, at)}
            <mark className="rounded-sm bg-foreground/10 font-semibold text-foreground">{text.slice(at, at + term.length)}</mark>
            {text.slice(at + term.length)}
        </>
    );
}

function Facts({ stats, loading }: { stats: DatabaseStats | undefined; loading: boolean }) {
    if (!stats) return loading ? <Skeleton className="h-3 w-12 shrink-0" /> : null;
    return (
        <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
            {stats.tableCount !== undefined && (
                <span className="hidden text-muted-foreground/80 sm:inline">
                    {stats.tableCount} {stats.tableCount === 1 ? "table" : "tables"}
                </span>
            )}
            {stats.sizeInBytes !== undefined && <span className="w-16 text-right text-muted-foreground">{formatBytes(stats.sizeInBytes, 1)}</span>}
        </span>
    );
}

function LoadingList() {
    return (
        <div className="overflow-hidden rounded-lg border" aria-busy="true" aria-label="Loading the databases">
            <div className="flex items-center gap-2 border-b p-2">
                <Skeleton className="mx-1 size-4" />
                <Skeleton className="h-8 flex-1" />
            </div>
            <div className="grid gap-3 p-3">
                {["w-2/5", "w-1/4", "w-1/2"].map((width) => (
                    <div key={width} className="flex items-center gap-2.5">
                        <Skeleton className="size-4" />
                        <Skeleton className={cn("h-3.5", width)} />
                        <Skeleton className="ml-auto h-3 w-12" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function Checklist({ sourceId, value, onChange, onUseAll }: DatabaseChecklistProps) {
    const id = useId();
    const { listing, stats, statsLoading, reload } = useDatabaseListing(sourceId);
    const [term, setTerm] = useState("");
    const [sort, setSort] = useState<Sort>("name");

    if (listing.status === "loading") return <LoadingList />;

    if (listing.status === "failed") {
        return (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <p className="min-w-0 text-sm text-muted-foreground">{listing.message}</p>
                <Button type="button" variant="outline" size="sm" onClick={reload}>
                    <RotateCw />
                    Try again
                </Button>
            </div>
        );
    }

    const { names } = listing;
    if (names.length === 0 && value.length === 0) {
        return <p className="rounded-lg border px-3 py-2.5 text-sm text-muted-foreground">DBackup sees no databases on this server.</p>;
    }

    const picked = new Set(value);
    const sizeOf = (name: string) => stats?.get(name)?.sizeInBytes;
    const hasSizes = names.some((name) => sizeOf(name) !== undefined);
    const ordered = [...names].sort((a, b) =>
        sort === "size" && hasSizes ? (sizeOf(b) ?? -1) - (sizeOf(a) ?? -1) : a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    // A database picked earlier that the server no longer has stays on top, so it can be unticked.
    const missing = value.filter((name) => !names.includes(name));
    const all = [...missing, ...ordered];
    const query = term.trim().toLowerCase();
    const visible = query ? all.filter((name) => name.toLowerCase().includes(query)) : all;
    const visiblePicked = visible.filter((name) => picked.has(name)).length;
    const hiddenPicked = query ? value.filter((name) => !visible.includes(name)).length : 0;
    const everyPicked = names.length > 0 && names.every((name) => picked.has(name));
    const head = visible.length > 0 && visiblePicked === visible.length ? true : visiblePicked > 0 ? "indeterminate" : false;

    const toggle = (name: string, on: boolean) => onChange(on ? [...value, name] : value.filter((entry) => entry !== name));
    // The checkbox of the head and Pick the shown work on what the search shows, the rest stays as it is.
    const setShown = (on: boolean) => {
        const shown = new Set(visible);
        onChange(on ? [...new Set([...value, ...visible])] : value.filter((name) => !shown.has(name)));
    };
    const total = (list: string[]) => formatBytes(list.reduce((sum, name) => sum + (sizeOf(name) ?? 0), 0), 1);

    return (
        <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 border-b p-2">
                <Checkbox
                    checked={head}
                    onCheckedChange={() => setShown(head !== true)}
                    disabled={visible.length === 0}
                    aria-label={query ? "Pick the shown databases" : "Pick every database"}
                    className="mx-1"
                />
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                        value={term}
                        onChange={(event) => setTerm(event.target.value)}
                        // The list sits inside the job form, where Enter would save the whole job.
                        onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
                        placeholder={`Search ${all.length} databases`}
                        aria-label="Search databases"
                        autoComplete="off"
                        spellCheck={false}
                        className="h-8 pr-8 pl-8"
                    />
                    {term && (
                        <button
                            type="button"
                            onClick={() => setTerm("")}
                            aria-label="Clear the search"
                            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <X className="size-3.5" />
                        </button>
                    )}
                </div>
                {hasSizes && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 px-2.5 text-xs"
                        onClick={() => setSort(sort === "name" ? "size" : "name")}
                        aria-label={sort === "name" ? "Sorted by name, sort by size" : "Sorted by size, sort by name"}
                    >
                        <ArrowUpDown className="size-3.5" />
                        {sort === "name" ? "Name" : "Size"}
                    </Button>
                )}
                <Button type="button" variant="outline" size="icon" className="size-8" onClick={reload} aria-label="Load the databases again">
                    <RotateCw className="size-3.5" />
                </Button>
            </div>

            <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-52 [&>[data-slot=scroll-area-viewport]>div]:block!">
                <ul className="grid gap-0.5 p-1">
                    {visible.map((name, index) => {
                        const on = picked.has(name);
                        return (
                            <li key={name}>
                                <Label
                                    htmlFor={`${id}-${index}`}
                                    className={cn(
                                        "cursor-pointer gap-2.5 rounded-md px-2 py-1.5 font-normal hover:bg-muted/50",
                                        on && "bg-tone-control/5 hover:bg-tone-control/10 dark:bg-tone-control/10",
                                    )}
                                >
                                    <Checkbox id={`${id}-${index}`} checked={on} onCheckedChange={(checked) => toggle(name, checked === true)} />
                                    <span className={cn("min-w-0 flex-1 truncate", on && "font-medium")}>
                                        <Highlight text={name} term={query} />
                                    </span>
                                    {missing.includes(name) ? (
                                        <span className="shrink-0 text-xs text-warning">Not on the server</span>
                                    ) : (
                                        <Facts stats={stats?.get(name)} loading={statsLoading} />
                                    )}
                                </Label>
                            </li>
                        );
                    })}
                    {visible.length === 0 && <li className="px-2 py-3 text-center text-sm text-muted-foreground">No database matches.</li>}
                </ul>
            </ScrollArea>

            {everyPicked && !query && onUseAll && (
                <p className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                    <Info className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>
                        Every database is picked. <span className="font-medium text-foreground">All databases</span> takes the ones added later too.
                    </span>
                </p>
            )}
            <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1.5 border-t bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 tabular-nums">
                    {query ? (
                        <>
                            {visible.length} shown · {value.length} picked
                            {hiddenPicked > 0 && <span className="text-foreground">, {hiddenPicked} of them hidden by the search</span>}
                        </>
                    ) : (
                        <>
                            <span className="font-medium text-foreground">
                                {value.length} of {all.length} picked
                            </span>
                            {hasSizes && ` · ${total(value)} of ${total(names)}`}
                        </>
                    )}
                    {missing.length > 0 && <span className="text-warning"> · {missing.length} no longer on the server</span>}
                </span>
                {query && visiblePicked < visible.length && (
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShown(true)}>
                        Pick the {visible.length} shown
                    </Button>
                )}
                {!query && everyPicked && onUseAll && (
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onUseAll}>
                        Use All databases
                    </Button>
                )}
                {!query && value.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange([])}>
                        <X className="size-3.5" />
                        Clear
                    </Button>
                )}
            </div>
        </div>
    );
}
