"use client";

import { PageHead } from "@/components/ui/page-head";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs } from "@/components/ui/tabs";

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
        <PageHead>
            <Tabs value={tab} onValueChange={(value) => onTab(value as ExplorerTab)} className="min-w-0 flex-1">
                <PageTabs
                    tabs={[{ value: "databases", label: "Databases", count: databases }, { value: "servers", label: "Servers", count: servers }]}
                    value={tab}
                    onValueChange={(value) => onTab(value as ExplorerTab)}
                    label="Explorer list"
                />
            </Tabs>
            <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
        </PageHead>
    );
}
