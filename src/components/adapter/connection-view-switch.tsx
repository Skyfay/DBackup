"use client";

import { LayoutGrid, LayoutPanelLeft, List } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ViewMode } from "@/lib/core/table-preferences";

export type ConnectionView = ViewMode;

const OPTIONS: { value: ConnectionView; label: string; Icon: typeof List }[] = [
    { value: "table", label: "Table", Icon: List },
    { value: "cards", label: "Cards", Icon: LayoutGrid },
    { value: "split", label: "List and details", Icon: LayoutPanelLeft },
];

/** Switches the connection lists between table, cards and the list with details beside it. */
export function ConnectionViewSwitch({ value, onChange }: { value: ConnectionView; onChange: (view: ConnectionView) => void }) {
    return (
        <Tabs value={value} onValueChange={(next) => onChange(next as ConnectionView)}>
            <TabsList aria-label="View">
                {OPTIONS.map(({ value: option, label, Icon }) => (
                    <TabsTrigger key={option} value={option} aria-label={`${label} view`} title={label} className="px-2.5">
                        <Icon />
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    );
}
