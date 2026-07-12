"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { AdapterDefinition } from "@/lib/adapters/definitions";
import { AdapterIcon } from "./adapter-icon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface AdapterPickerProps {
    adapters: AdapterDefinition[];
    onSelect: (adapter: AdapterDefinition) => void;
}

interface AdapterGroup {
    label: string;
    items: AdapterDefinition[];
}

function groupAdapters(adapters: AdapterDefinition[]): AdapterGroup[] {
    const groups: AdapterGroup[] = [];
    const seen = new Map<string, AdapterDefinition[]>();

    for (const adapter of adapters) {
        const key = adapter.group ?? "";
        if (!seen.has(key)) {
            const items: AdapterDefinition[] = [];
            seen.set(key, items);
            groups.push({ label: key, items });
        }
        seen.get(key)!.push(adapter);
    }

    return groups;
}

function AdapterCard({ adapter, onSelect }: {
    adapter: AdapterDefinition;
    onSelect: (adapter: AdapterDefinition) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => onSelect(adapter)}
            className={cn(
                "flex flex-col items-center gap-2 rounded-lg border p-4 text-center",
                "hover:bg-accent hover:border-primary/50 transition-colors cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
        >
            <AdapterIcon adapterId={adapter.id} className="h-8 w-8" />
            <span className="inline-flex items-center gap-1.5 text-sm font-medium leading-tight">
                {adapter.name}
                {adapter.beta && (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                        Beta
                    </span>
                )}
            </span>
        </button>
    );
}

function AdapterGrid({ adapters, onSelect }: { adapters: AdapterDefinition[]; onSelect: (adapter: AdapterDefinition) => void }) {
    if (adapters.length === 0) {
        return <p className="text-sm text-muted-foreground text-center py-6">No adapters match your search.</p>;
    }

    return (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {adapters.map((adapter) => (
                <AdapterCard
                    key={adapter.id}
                    adapter={adapter}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
}

export function AdapterPicker({ adapters, onSelect }: AdapterPickerProps) {
    const [search, setSearch] = useState("");
    const groups = useMemo(() => groupAdapters(adapters), [adapters]);
    const hasGroups = groups.some(g => g.label !== "");

    const filteredAdapters = useMemo(() => {
        if (!search.trim()) return adapters;
        const term = search.toLowerCase();
        return adapters.filter(a => a.name.toLowerCase().includes(term));
    }, [adapters, search]);

    const searchBar = (
        <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
                placeholder="Search adapters..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
            />
        </div>
    );

    // If no groups defined (e.g. databases, notifications), show flat grid with search
    if (!hasGroups) {
        return (
            <div className="space-y-4">
                {searchBar}
                <AdapterGrid adapters={filteredAdapters} onSelect={onSelect} />
            </div>
        );
    }

    // When searching with groups, show flat filtered results
    if (search.trim()) {
        return (
            <div className="space-y-4">
                {searchBar}
                <AdapterGrid adapters={filteredAdapters} onSelect={onSelect} />
            </div>
        );
    }

    // Tabbed view for grouped adapters (storage destinations)
    return (
        <div className="space-y-4">
            {searchBar}
            <Tabs defaultValue="all" className="w-full">
                <TabsList className="w-full flex-wrap h-auto gap-1 mb-4">
                    <TabsTrigger value="all">All</TabsTrigger>
                    {groups.map((group) => (
                        <TabsTrigger key={group.label} value={group.label}>
                            {group.label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value="all">
                    <AdapterGrid adapters={adapters} onSelect={onSelect} />
                </TabsContent>

                {groups.map((group) => (
                    <TabsContent key={group.label} value={group.label}>
                        <AdapterGrid adapters={group.items} onSelect={onSelect} />
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}
