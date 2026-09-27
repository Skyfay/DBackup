"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ExplorerTab = "databases" | "servers";

/** The tabs of the Database Explorer with how many each lists, and on the right what goes with them. */
export function ExplorerTabs({ tab, databases, servers, onTab, children }: {
    tab: ExplorerTab;
    databases: number;
    servers: number;
    onTab: (tab: ExplorerTab) => void;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <Tabs value={tab} onValueChange={(value) => onTab(value as ExplorerTab)}>
                <TabsList aria-label="Show">
                    {([["databases", "Databases", databases], ["servers", "Servers", servers]] as const).map(([value, label, total]) => (
                        <TabsTrigger key={value} value={value}>
                            <span className="flex items-center gap-2">
                                {label}
                                <span className="text-xs font-normal text-muted-foreground tabular-nums">{total.toLocaleString()}</span>
                            </span>
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>
            <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
        </div>
    );
}
