"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabCount, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface PageTab {
    value: string;
    label: string;
    /** How many entries the list holds, left out while it is not known. */
    count?: number;
}

/** The name of a list and its count. The space between them is only for screen readers, the flex gap draws it. */
function TabName({ tab }: { tab: PageTab }) {
    return (
        <span className="flex items-center gap-2">
            {tab.label}
            {tab.count !== undefined && <>{" "}<TabCount value={tab.count} /></>}
        </span>
    );
}

interface PageTabsProps {
    tabs: PageTab[];
    value: string;
    onValueChange: (value: string) => void;
    /** What the lists are, for screen readers. */
    label: string;
}

/**
 * The lists of a page in its `PageHead`: on a phone a `Select` that fills the row beside the
 * actions, however many lists there are, and from md up the page tabs, which scroll sideways when
 * they outgrow the head. Both are hidden by CSS rather than by the measured screen, so neither pops
 * in after loading. It sits inside the `Tabs` of the page, which holds the open list.
 */
export function PageTabs({ tabs, value, onValueChange, label }: PageTabsProps) {
    return (
        <>
            <div className="min-w-0 flex-1 md:hidden">
                <Select value={value} onValueChange={onValueChange}>
                    <SelectTrigger className="w-full" aria-label={label}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {tabs.map((tab) => (
                            <SelectItem key={tab.value} value={tab.value}>
                                <TabName tab={tab} />
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <ScrollArea horizontal className="hidden min-w-0 md:block">
                <TabsList variant="page" aria-label={label}>
                    {tabs.map((tab) => (
                        <TabsTrigger key={tab.value} value={tab.value}>
                            <TabName tab={tab} />
                        </TabsTrigger>
                    ))}
                </TabsList>
            </ScrollArea>
        </>
    );
}
