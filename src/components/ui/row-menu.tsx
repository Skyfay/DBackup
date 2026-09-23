"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from "@/components/ui/context-menu";
import { capitalize } from "@/components/ui/data-table-bulk-dialogs";
import type { BulkAction, RowMenuBulk } from "@/components/ui/data-table";
import { countNoun } from "@/lib/core/bulk";

/**
 * The head of a row menu. It stays neutral, since the menu has no task of its own: each entry
 * below shows the color of the dialog it opens.
 */
export function RowMenuHead({ tile, title, note }: { tile: React.ReactNode; title: string; note: string }) {
    return (
        <div className="-mx-1 -mt-1 mb-1 flex min-w-0 items-center gap-2.5 border-b bg-muted/40 px-3 py-2.5">
            {tile}
            <div className="grid min-w-0 gap-0.5">
                <p className="truncate text-sm font-semibold" title={title}>
                    {title}
                </p>
                <p className="truncate text-xs text-muted-foreground">{note}</p>
            </div>
        </div>
    );
}

/** The right click menu for a selection of several rows, with the bulk actions of the table. */
export function SelectionMenu<TData>({ bulk }: { bulk: RowMenuBulk<TData> }) {
    const labels = bulk.actions[0]?.labels;
    const settings = bulk.actions.filter((action) => action.placement === "menu");
    const rest = bulk.actions.filter((action) => action.placement !== "menu");

    const entry = (action: BulkAction<TData>) => {
        const Icon = action.icon;
        const label = action.label?.(bulk.selected) ?? `${capitalize(action.labels.verb)} ${countNoun(bulk.selected.length, action.labels)}`;
        return (
            <ContextMenuItem
                key={action.id}
                onSelect={() => bulk.start(action)}
                variant={action.variant === "destructive" ? "destructive" : "default"}
                tone={action.variant === "destructive" ? "destructive" : "neutral"}
            >
                {Icon && <Icon />} {label}
            </ContextMenuItem>
        );
    };

    // One section per group, in the order the groups first appear.
    const sections: { label?: string; actions: BulkAction<TData>[] }[] = [];
    for (const action of settings) {
        const section = sections.find((item) => item.label === action.group);
        if (section) section.actions.push(action);
        else sections.push({ label: action.group, actions: [action] });
    }

    return (
        <ContextMenuContent className="w-60">
            <RowMenuHead
                tile={
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-tone-control text-tone-control-foreground">
                        <Check className="size-4" />
                    </span>
                }
                title={labels ? `${countNoun(bulk.selected.length, labels)} selected` : `${bulk.selected.length} selected`}
                note="Every action runs on all of them"
            />
            {sections.map((section, index) => (
                <React.Fragment key={section.label ?? `group-${index}`}>
                    {section.label && <ContextMenuLabel>{section.label}</ContextMenuLabel>}
                    {section.actions.map(entry)}
                </React.Fragment>
            ))}
            {sections.length > 0 && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={bulk.clearSelection}>
                <X /> Clear selection
            </ContextMenuItem>
            {rest.map(entry)}
        </ContextMenuContent>
    );
}
