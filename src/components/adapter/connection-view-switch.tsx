"use client";

import { LayoutGrid, List } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ViewMode } from "@/lib/core/table-preferences";

/** The views a connection list offers so far. */
export type ConnectionView = Extract<ViewMode, "table" | "cards">;

const OPTIONS: { value: ConnectionView; label: string; Icon: typeof List }[] = [
    { value: "table", label: "Table", Icon: List },
    { value: "cards", label: "Cards", Icon: LayoutGrid },
];

/** Switches the connection lists between table and cards. */
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
