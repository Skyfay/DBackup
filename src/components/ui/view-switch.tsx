"use client";

import { LayoutGrid, LayoutPanelLeft, List } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ViewMode } from "@/lib/core/table-preferences";

const OPTIONS: { value: ViewMode; label: string; Icon: typeof List }[] = [
    { value: "table", label: "Table", Icon: List },
    { value: "cards", label: "Cards", Icon: LayoutGrid },
    { value: "split", label: "List and details", Icon: LayoutPanelLeft },
];

interface ViewSwitchProps {
    value: ViewMode;
    onChange: (view: ViewMode) => void;
    /** The views a page offers, all three when left out. */
    views?: ViewMode[];
}

/** Switches a list page between table, cards and the list with details beside it. */
export function ViewSwitch({ value, onChange, views }: ViewSwitchProps) {
    const options = views ? OPTIONS.filter((option) => views.includes(option.value)) : OPTIONS;
    return (
        <Tabs value={value} onValueChange={(next) => onChange(next as ViewMode)}>
            <TabsList aria-label="View">
                {options.map(({ value: option, label, Icon }) => (
                    <TabsTrigger key={option} value={option} aria-label={`${label} view`} title={label} className="px-2.5">
                        <Icon />
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    );
}
