"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { AdapterDefinition } from "@/lib/adapters/definitions";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AdapterIcon } from "./adapter-icon";

interface AdapterGroup {
    label: string;
    items: AdapterDefinition[];
}

/** The adapters under their group heading, in the order the definitions list them. */
function groupAdapters(adapters: AdapterDefinition[]): AdapterGroup[] {
    const groups: AdapterGroup[] = [];
    const byLabel = new Map<string, AdapterDefinition[]>();

    for (const adapter of adapters) {
        const label = adapter.group ?? "";
        let items = byLabel.get(label);
        if (!items) {
            items = [];
            byLabel.set(label, items);
            groups.push({ label, items });
        }
        items.push(adapter);
    }

    return groups;
}

/** The groups a search leaves, as one list of hits that keeps each group as a line under the name. */
function useAdapterGroups(adapters: AdapterDefinition[], search: string): AdapterGroup[] {
    return useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return groupAdapters(adapters);
        const hits = adapters.filter(
            (adapter) => adapter.name.toLowerCase().includes(term) || (adapter.group ?? "").toLowerCase().includes(term)
        );
        return hits.length > 0 ? [{ label: "", items: hits }] : [];
    }, [adapters, search]);
}

function AdapterSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
                placeholder="Search types"
                aria-label="Search types"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="pl-8"
            />
        </div>
    );
}

function AdapterRow({ adapter, onSelect }: { adapter: AdapterDefinition; onSelect: (adapter: AdapterDefinition) => void }) {
    return (
        <button
            type="button"
            onClick={() => onSelect(adapter)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                <AdapterIcon adapterId={adapter.id} className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{adapter.name}</span>
                    {adapter.beta && (
                        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Beta</span>
                    )}
                </span>
                {adapter.group && <span className="block truncate text-xs text-muted-foreground">{adapter.group}</span>}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
    );
}

/**
 * The types on offer, grouped and one per row. The headings stay in view while the list
 * scrolls, which is what makes one long list readable as the adapter list grows.
 */
function AdapterGroups({ groups, onSelect }: { groups: AdapterGroup[]; onSelect: (adapter: AdapterDefinition) => void }) {
    if (groups.length === 0) {
        return <p className="py-6 text-center text-sm text-muted-foreground">No type matches your search.</p>;
    }

    return (
        <>
            {groups.map((group) => (
                <div key={group.label || "results"}>
                    {group.label && (
                        <p className="sticky top-0 z-10 bg-card px-2 py-1.5 text-xs font-medium text-muted-foreground">{group.label}</p>
                    )}
                    {group.items.map((adapter) => (
                        <AdapterRow key={adapter.id} adapter={adapter} onSelect={onSelect} />
                    ))}
                </div>
            ))}
        </>
    );
}

interface AdapterPickerProps {
    adapters: AdapterDefinition[];
    onSelect: (adapter: AdapterDefinition) => void;
}

/** Search and list on their own, for a page that brings its own heading, like the setup wizard. */
export function AdapterPicker({ adapters, onSelect }: AdapterPickerProps) {
    const [search, setSearch] = useState("");
    const groups = useAdapterGroups(adapters, search);

    return (
        <div className="space-y-3">
            <AdapterSearch value={search} onChange={setSearch} />
            <div>
                <AdapterGroups groups={groups} onSelect={onSelect} />
            </div>
        </div>
    );
}

/**
 * The first step of adding a connection: which kind it is.
 *
 * One list rather than a grid, because the names run long and the adapter list keeps growing.
 * Only the list scrolls, so the search and the buttons stay put however many types there are.
 */
export function AdapterPickerDialog({
    adapters,
    title,
    onSelect,
}: AdapterPickerProps & {
    /** Names what is being created, like "Add database". */
    title: string;
}) {
    const [search, setSearch] = useState("");
    const groups = useAdapterGroups(adapters, search);

    return (
        <>
            <DialogHead tone="create" icon={Plus} className="px-5 py-4">
                <DialogTitle className="text-base">{title}</DialogTitle>
                <DialogDescription className={dialogNoteClass("create")}>Pick a type, then fill in the connection.</DialogDescription>
            </DialogHead>

            <div className="px-5 pt-4">
                <AdapterSearch value={search} onChange={setSearch} />
            </div>

            {/* The height belongs on the viewport: the dialog only carries a max-height, which a
                percentage height cannot resolve against, and the list would grow past it.
                Block instead of Radix's `display: table` wrapper, so long names are cut off. */}
            <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-12rem)] [&>[data-slot=scroll-area-viewport]>div]:block!">
                <div className="px-5 py-3">
                    <AdapterGroups groups={groups} onSelect={onSelect} />
                </div>
            </ScrollArea>

            <div className={`${DIALOG_FOOTER} flex items-center justify-between gap-3`}>
                <span className="text-xs text-muted-foreground">Step 1 of 2</span>
                <DialogClose asChild>
                    <Button variant="outline" size="sm">
                        Cancel
                    </Button>
                </DialogClose>
            </div>
        </>
    );
}
