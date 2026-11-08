"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from "@/components/ui/context-menu";
import type { RowMenuBulk } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RowMenuHead, SelectionMenu } from "@/components/ui/row-menu";
import { cn } from "@/lib/utils";
import type { BackupAction, BackupActionGroup } from "./backup-actions";

/** The label of an entry, with its note on a second line. */
function EntryLabel({ action }: { action: BackupAction }) {
    if (!action.note) return <>{action.label}</>;
    return (
        <span className="grid min-w-0 gap-0.5">
            <span className="truncate">{action.label}</span>
            <span className="truncate text-xs text-muted-foreground">{action.note}</span>
        </span>
    );
}

/** A muted line at the foot of a menu, like what stays with the provider of a shared backup. */
function MenuFoot({ children }: { children: React.ReactNode }) {
    return <div className="-mx-1 -mb-1 mt-1 border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{children}</div>;
}

/** Entries with a note need more room than the plain ones. */
const widthOf = (groups: BackupActionGroup[], foot: React.ReactNode) => (foot || groups.some((group) => group.actions.some((action) => action.note)) ? "w-72" : "w-60");

interface BackupRowMenuProps {
    name: string;
    groups: BackupActionGroup[];
    /** Outline next to the buttons of the details, ghost at the end of a row. */
    variant?: "ghost" | "outline";
    align?: "start" | "end";
    /** A muted line under the entries. */
    foot?: React.ReactNode;
}

/** Everything a backup can do, behind the button at the end of its row or in its details. */
export function BackupRowMenu({ name, groups, variant = "ghost", align = "end", foot }: BackupRowMenuProps) {
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
            <DropdownMenuContent align={align} className={widthOf(groups, foot)}>
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
                                className={cn(action.note && "items-start [&>svg]:mt-0.5")}
                            >
                                <action.icon /> <EntryLabel action={action} />
                            </DropdownMenuItem>
                        ))}
                    </React.Fragment>
                ))}
                {foot && <MenuFoot>{foot}</MenuFoot>}
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
    /** A muted line under the entries. */
    foot?: React.ReactNode;
}

/** What a right click on a backup offers: its own actions, or the ones for the whole selection. */
export function BackupContextMenu<TData>({ tile, title, note, groups, bulk, foot }: BackupContextMenuProps<TData>) {
    if (bulk) return <SelectionMenu bulk={bulk} />;
    if (groups.length === 0) return null;
    return (
        <ContextMenuContent className={widthOf(groups, foot)}>
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
                            className={cn(action.note && "items-start [&>svg]:mt-0.5")}
                        >
                            <action.icon /> <EntryLabel action={action} />
                        </ContextMenuItem>
                    ))}
                </React.Fragment>
            ))}
            {foot && <MenuFoot>{foot}</MenuFoot>}
        </ContextMenuContent>
    );
}
