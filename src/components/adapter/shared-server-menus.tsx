"use client";

import * as React from "react";
import { Building2, MoreHorizontal } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Button } from "@/components/ui/button";
import { ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RowMenuHead } from "@/components/ui/row-menu";
import type { SharedServerTerms } from "@/services/sharing/shared-server-rows";
import { databasesYours } from "./connection-shared-cells";
import { providerKeepsNote, type SharedMenuEntry, type SharedMenuGroup } from "./shared-server-actions";

/**
 * The menus of a server of another tenant, from the button at the end of its row and from a right
 * click, both from the same list of entries. Back up now names each database with what is left of
 * it today, and the foot says that the rest stays with the provider.
 */

/** An entry of two lines, its icon beside the first one. */
const ENTRY_CLASS = "items-start [&>svg]:mt-0.5";

interface SharedServerMenuProps {
    terms: SharedServerTerms;
    adapterId: string;
    groups: SharedMenuGroup[];
}

function Head({ terms, adapterId }: { terms: SharedServerTerms; adapterId: string }) {
    return (
        <RowMenuHead
            tile={
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card">
                    <AdapterIcon adapterId={adapterId} className="size-4" />
                </span>
            }
            title={terms.serverName}
            note={`from ${terms.providerName} · ${databasesYours(terms.databases.length)}`}
        />
    );
}

/** The icon, the label and the second line of an entry, in a row menu or in the menu of a database. */
export function EntryContent({ entry }: { entry: SharedMenuEntry }) {
    return (
        <>
            <entry.icon />
            <span className="grid min-w-0 gap-0.5">
                <span className="truncate">{entry.label}</span>
                {entry.note && <span className="truncate text-xs text-muted-foreground">{entry.note}</span>}
            </span>
        </>
    );
}

export function MenuFoot({ terms }: { terms: Pick<SharedServerTerms, "providerName"> }) {
    return (
        <div className="-mx-1 -mb-1 mt-1 flex gap-2 border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Building2 className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>{providerKeepsNote(terms)}</span>
        </div>
    );
}

/** The entries of a dropdown, for the row menu and the menu of a database in the panel. */
export function DropdownEntries({ groups }: { groups: SharedMenuGroup[] }) {
    return groups.map((group, index) => (
        <React.Fragment key={group.label ?? `group-${index}`}>
            {index > 0 && <DropdownMenuSeparator />}
            {group.label && <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{group.label}</DropdownMenuLabel>}
            {group.entries.map((entry) => (
                <DropdownMenuItem key={entry.id} onSelect={entry.onSelect} disabled={entry.disabled} tone={entry.tone} className={ENTRY_CLASS}>
                    <EntryContent entry={entry} />
                </DropdownMenuItem>
            ))}
        </React.Fragment>
    ));
}

/** The button at the end of the row, the way in for keyboard and touch. */
export function SharedServerRowMenu({ terms, adapterId, groups }: SharedServerMenuProps) {
    return (
        // Not modal, so a dialog opened from an item gets focus and pointer events back cleanly.
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Open menu for {terms.serverName}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
                <Head terms={terms} adapterId={adapterId} />
                <DropdownEntries groups={groups} />
                <MenuFoot terms={terms} />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** What a right click on the row offers. A provided server is never part of a selection. */
export function SharedServerContextMenu({ terms, adapterId, groups }: SharedServerMenuProps) {
    return (
        <ContextMenuContent className="w-72">
            <Head terms={terms} adapterId={adapterId} />
            {groups.map((group, index) => (
                <React.Fragment key={group.label ?? `group-${index}`}>
                    {group.label ? <ContextMenuLabel>{group.label}</ContextMenuLabel> : index > 0 && <ContextMenuSeparator />}
                    {group.entries.map((entry) => (
                        <ContextMenuItem key={entry.id} onSelect={entry.onSelect} disabled={entry.disabled} tone={entry.tone} className={ENTRY_CLASS}>
                            <EntryContent entry={entry} />
                        </ContextMenuItem>
                    ))}
                </React.Fragment>
            ))}
            <MenuFoot terms={terms} />
        </ContextMenuContent>
    );
}
