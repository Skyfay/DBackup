"use client";

import * as React from "react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { RowMenuBulk } from "@/components/ui/data-table";
import { RowMenuHead, SelectionMenu } from "@/components/ui/row-menu";
import type { AdapterConfig } from "./types";
import { kindNames } from "./connection-columns";
import { connectionActions, type ConnectionActionHandlers } from "./connection-actions";

interface ConnectionContextMenuProps extends ConnectionActionHandlers {
    config: AdapterConfig;
    /** Set when the right clicked row is one of several selected rows. */
    bulk: RowMenuBulk<AdapterConfig> | null;
}

/** What a right click on a connection offers: its own actions, or the ones for the whole selection. */
export function ConnectionContextMenu({ config, bulk, ...handlers }: ConnectionContextMenuProps) {
    const groups = connectionActions(handlers);
    if (bulk) return <SelectionMenu bulk={bulk} />;
    if (groups.length === 0) return null;

    return (
        <ContextMenuContent className="w-56">
            <RowMenuHead
                tile={
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card">
                        <AdapterIcon adapterId={config.adapterId} className="size-4" />
                    </span>
                }
                title={config.name}
                // The type alone, since a long one like "Microsoft SQL Server" leaves no room for more.
                note={kindNames.get(config.adapterId) ?? config.adapterId}
            />
            {groups.map((group, index) => (
                <React.Fragment key={group.label ?? "actions"}>
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
