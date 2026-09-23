"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { connectionActions, type ConnectionActionHandlers } from "./connection-actions";

interface ConnectionRowActionsProps extends ConnectionActionHandlers {
    name: string;
}

/**
 * Everything a row can do, behind one button instead of a row of icons. The entries come from
 * `connectionActions`, the same list the right click menu renders.
 */
export function ConnectionRowActions({ name, ...handlers }: ConnectionRowActionsProps) {
    const groups = connectionActions(handlers);
    if (groups.length === 0) return null;

    return (
        // Not modal, so a dialog opened from an item gets focus and pointer events back cleanly.
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Open menu for {name}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
                {groups.map((group, index) => (
                    <React.Fragment key={group.label ?? "actions"}>
                        {index > 0 && <DropdownMenuSeparator />}
                        {group.actions.map((action) => (
                            <DropdownMenuItem
                                key={action.id}
                                onSelect={action.onSelect}
                                disabled={action.disabled}
                                variant={action.destructive ? "destructive" : "default"}
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
