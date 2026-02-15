"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { AdapterDefinition } from "@/lib/adapters/definitions";
import { getAdapterIcon } from "./utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LucideIcon } from "lucide-react";

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

function AdapterCard({ adapter, icon: Icon, onSelect }: { adapter: AdapterDefinition; icon: LucideIcon; onSelect: (adapter: AdapterDefinition) => void }) {
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
            <Icon className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm font-medium leading-tight">{adapter.name}</span>
        </button>
    );
}

function AdapterGrid({ adapters, onSelect }: { adapters: AdapterDefinition[]; onSelect: (adapter: AdapterDefinition) => void }) {
    const iconMap = useMemo(() => {
        const map = new Map<string, LucideIcon>();
        for (const adapter of adapters) {
            map.set(adapter.id, getAdapterIcon(adapter.id));
        }
        return map;
    }, [adapters]);

    return (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {adapters.map((adapter) => (
                <AdapterCard key={adapter.id} adapter={adapter} icon={iconMap.get(adapter.id)!} onSelect={onSelect} />
            ))}
        </div>
    );
}

export function AdapterPicker({ adapters, onSelect }: AdapterPickerProps) {
    const groups = useMemo(() => groupAdapters(adapters), [adapters]);
    const hasGroups = groups.some(g => g.label !== "");

    // If no groups defined (e.g. databases, notifications), show flat grid
    if (!hasGroups) {
        return <AdapterGrid adapters={adapters} onSelect={onSelect} />;
    }

    // Tabbed view for grouped adapters (storage destinations)
    return (
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
    );
}
