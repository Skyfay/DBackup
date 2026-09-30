"use client";

import type { LucideIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TabAttention } from "@/lib/core/tab-attention";
import { cn } from "@/lib/utils";

export interface PageTab {
    value: string;
    label: string;
    icon: LucideIcon;
    /** Something in the list needs a look: a dot beside the name, and what it is on hover. */
    attention?: TabAttention;
}

/** The icon and name of a list, and its dot. The dot says in words what it means to screen readers. */
function TabName({ tab }: { tab: PageTab }) {
    const Icon = tab.icon;
    return (
        <span className="flex items-center gap-2">
            <Icon className="size-4" aria-hidden="true" />
            {tab.label}
            {tab.attention && (
                <>
                    <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tab.attention.tone === "destructive" ? "bg-destructive" : "bg-warning")} />
                    <span className="sr-only">, needs a look: {tab.attention.note}</span>
                </>
            )}
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
                    {tabs.map((tab) => {
                        // The tooltip writes its own data-state onto the tab it wraps, which the pill of the
                        // open tab reads, so the tab states its own and wins over the one of the tooltip.
                        const trigger = (
                            <TabsTrigger key={tab.value} value={tab.value} data-state={tab.value === value ? "active" : "inactive"}>
                                <TabName tab={tab} />
                            </TabsTrigger>
                        );
                        return tab.attention ? (
                            <Tooltip key={tab.value}>
                                <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                                <TooltipContent side="bottom">{tab.attention.note}</TooltipContent>
                            </Tooltip>
                        ) : trigger;
                    })}
                </TabsList>
            </ScrollArea>
        </>
    );
}
