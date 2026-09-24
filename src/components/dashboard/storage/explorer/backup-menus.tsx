"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from "@/components/ui/context-menu";
import type { RowMenuBulk } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RowMenuHead, SelectionMenu } from "@/components/ui/row-menu";
import type { BackupActionGroup } from "./backup-actions";

interface BackupRowMenuProps {
    name: string;
    groups: BackupActionGroup[];
    /** Outline next to the buttons of the details, ghost at the end of a row. */
    variant?: "ghost" | "outline";
    align?: "start" | "end";
}

/** Everything a backup can do, behind the button at the end of its row or in its details. */
export function BackupRowMenu({ name, groups, variant = "ghost", align = "end" }: BackupRowMenuProps) {
    if (groups.length === 0) return null;
    return (
        // Not modal, so a dialog opened from an item gets focus and pointer events back cleanly.
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button variant={variant} className="size-8 p-0">
                    <MoreHorizontal />
                    <span className="sr-only">Open menu for {name}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={align} className="w-60">
                {groups.map((group, index) => (
                    <React.Fragment key={group.label ?? `group-${index}`}>
                        {index > 0 && <DropdownMenuSeparator />}
                        {group.label && <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{group.label}</DropdownMenuLabel>}
                        {group.actions.map((action) => (
                            <DropdownMenuItem
                                key={action.id}
                                onSelect={action.onSelect}
                                disabled={action.disabled}
                                variant={action.tone === "destructive" ? "destructive" : "default"}
                                tone={action.tone}
                            >
                                <action.icon /> {action.label}
                            </DropdownMenuItem>
                        ))}
                    </React.Fragment>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

interface BackupContextMenuProps<TData> {
    tile: React.ReactNode;
    title: string;
    note: string;
    groups: BackupActionGroup[];
    /** Set when the right clicked row is one of several selected rows. */
    bulk: RowMenuBulk<TData> | null;
}

/** What a right click on a backup offers: its own actions, or the ones for the whole selection. */
export function BackupContextMenu<TData>({ tile, title, note, groups, bulk }: BackupContextMenuProps<TData>) {
    if (bulk) return <SelectionMenu bulk={bulk} />;
    if (groups.length === 0) return null;
    return (
        <ContextMenuContent className="w-60">
            <RowMenuHead tile={tile} title={title} note={note} />
            {groups.map((group, index) => (
                <React.Fragment key={group.label ?? `group-${index}`}>
                    {group.label ? <ContextMenuLabel>{group.label}</ContextMenuLabel> : index > 0 && <ContextMenuSeparator />}
                    {group.actions.map((action) => (
                        <ContextMenuItem
                            key={action.id}
                            onSelect={action.onSelect}
                            disabled={action.disabled}
                            variant={action.tone === "destructive" ? "destructive" : "default"}
                            tone={action.tone}
                        >
                            <action.icon /> {action.label}
                        </ContextMenuItem>
                    ))}
                </React.Fragment>
            ))}
        </ContextMenuContent>
    );
}
