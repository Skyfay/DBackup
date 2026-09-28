"use client";

import { PageHead } from "@/components/ui/page-head";
import { TabCount, Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ExplorerTab = "databases" | "servers";

/** The tabs of the Database Explorer with how many each lists, and on the right what goes with them. From md up they head the card of the list. */
export function ExplorerTabs({ tab, databases, servers, onTab, children }: {
    tab: ExplorerTab;
    databases: number;
    servers: number;
    onTab: (tab: ExplorerTab) => void;
    children?: React.ReactNode;
}) {
    return (
        <PageHead className="flex-wrap">
            <Tabs value={tab} onValueChange={(value) => onTab(value as ExplorerTab)}>
                <TabsList variant="page" aria-label="Show">
                    {([["databases", "Databases", databases], ["servers", "Servers", servers]] as const).map(([value, label, total]) => (
                        <TabsTrigger key={value} value={value}>
                            <span className="flex items-center gap-2">
                                {label}
                                <TabCount value={total} />
                            </span>
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>
            <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
        </PageHead>
    );
}
