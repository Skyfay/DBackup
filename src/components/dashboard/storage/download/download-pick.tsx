"use client";

import { useId, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatBytes } from "@/lib/utils";
import { SEARCH_FROM, headState, shown, sizeOf, toggleShown, type DownloadItem } from "./download-model";

interface PickGroupProps {
    /** The name of the group, like Databases. */
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    items: DownloadItem[];
    picked: ReadonlySet<string>;
    onPicked: (next: Set<string>) => void;
    /** An action beside a row, like Single files for a folder. */
    rowAction?: (item: DownloadItem) => React.ReactNode;
}

/**
 * A group of the download dialog: a checkbox in its head for what the search shows, the rows
 * with their size, and a foot that counts the picked ones. The search only shows from
 * `SEARCH_FROM` entries on, below that the rows are quicker read than searched.
 */
export function PickGroup({ label, icon: Icon, items, picked, onPicked, rowAction }: PickGroupProps) {
    const id = useId();
    const [term, setTerm] = useState("");
    const searchable = items.length >= SEARCH_FROM;
    const visible = shown(items, searchable ? term : "");
    const head = headState(visible, picked);
    const chosen = items.filter((item) => picked.has(item.id));
    const size = sizeOf(chosen);
    const query = searchable && term.trim() !== "";

    const toggle = (item: DownloadItem, on: boolean) => {
        const next = new Set(picked);
        if (on) next.add(item.id);
        else next.delete(item.id);
        onPicked(next);
    };

    return (
        <section aria-label={label} className="overflow-hidden rounded-lg border">
            <div className="flex min-h-12 items-center gap-2.5 border-b px-3 py-2">
                <Checkbox
                    checked={head}
                    onCheckedChange={() => onPicked(toggleShown(visible, picked, head !== true))}
                    disabled={visible.length === 0}
                    aria-label={query ? `Pick the shown ${label.toLowerCase()}` : `Pick all ${label.toLowerCase()}`}
                />
                <span className="text-sm font-semibold">{label}</span>
                <span className="rounded-md bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">{items.length}</span>
                {searchable && (
                    <div className="relative ml-auto w-full max-w-60 min-w-0">
                        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            value={term}
                            onChange={(event) => setTerm(event.target.value)}
                            placeholder={`Search ${label.toLowerCase()}`}
                            aria-label={`Search ${label.toLowerCase()}`}
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
                )}
            </div>

            <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-56">
                <ul className="grid gap-0.5 p-1">
                    {visible.map((item, index) => {
                        const on = picked.has(item.id);
                        return (
                            <li key={item.id} className={cn("flex items-center gap-2 rounded-md pr-2 hover:bg-muted/50", on && "bg-tone-control/5 hover:bg-tone-control/10 dark:bg-tone-control/10")}>
                                <Label htmlFor={`${id}-${index}`} className="min-w-0 flex-1 cursor-pointer gap-2.5 px-2 py-1.5 font-normal">
                                    <Checkbox id={`${id}-${index}`} checked={on} onCheckedChange={(checked) => toggle(item, checked === true)} />
                                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                                    <span className="grid min-w-0 flex-1 gap-0.5">
                                        <span className={cn("truncate", on && "font-medium")}>{item.name}</span>
                                        <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
                                    </span>
                                </Label>
                                {rowAction?.(item)}
                                <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{item.size !== null ? formatBytes(item.size, 1) : ""}</span>
                            </li>
                        );
                    })}
                    {visible.length === 0 && <li className="px-2 py-3 text-center text-sm text-muted-foreground">Nothing matches.</li>}
                </ul>
            </ScrollArea>

            <p className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground tabular-nums">
                {query ? `${visible.length} of ${items.length} shown · ` : ""}
                <span className="font-medium text-foreground">{chosen.length} of {items.length} picked</span>
                {chosen.length > 0 && size !== null ? ` · ${formatBytes(size, 1)}` : ""}
            </p>
        </section>
    );
}

/** Opens the files of a folder on the restore page, which picks and downloads single files. */
export function SingleFilesButton({ onOpen, name }: { onOpen: () => void; name: string }) {
    return (
        <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={onOpen} aria-label={`Single files of ${name}`}>
            <ArrowUpRight className="size-3.5" />
            Single files
        </Button>
    );
}
