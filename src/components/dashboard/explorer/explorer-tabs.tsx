"use client";

import { Database, Server } from "lucide-react";
import { PageHead } from "@/components/ui/page-head";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs } from "@/components/ui/tabs";
import type { TabAttention } from "@/lib/core/tab-attention";

export type ExplorerTab = "databases" | "servers";

/** The tabs of the Database Explorer with what needs a look in each, and on the right what goes with them. From md up they head the card of the list. */
export function ExplorerTabs({ tab, attention, onTab, children }: {
    tab: ExplorerTab;
    attention: { databases?: TabAttention; servers?: TabAttention };
    onTab: (tab: ExplorerTab) => void;
    children?: React.ReactNode;
}) {
    return (
        <PageHead>
            <Tabs value={tab} onValueChange={(value) => onTab(value as ExplorerTab)} className="min-w-0 flex-1">
                <PageTabs
                    tabs={[
                        { value: "databases", label: "Databases", icon: Database, attention: attention.databases },
                        { value: "servers", label: "Servers", icon: Server, attention: attention.servers },
                    ]}
                    value={tab}
                    onValueChange={(value) => onTab(value as ExplorerTab)}
                    label="Explorer list"
                />
            </Tabs>
            <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
        </PageHead>
    );
}
