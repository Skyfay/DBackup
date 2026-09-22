"use client";

import { ArrowLeftRight, BarChart3, Copy, MoreHorizontal, Pencil, SearchCode, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ConnectionRowActionsProps {
    name: string;
    onExplore?: () => void;
    onHistory?: () => void;
    onEdit?: () => void;
    onClone?: () => void;
    /** Creates the same connection in the other storage role, where the adapter supports it. */
    counterpart?: { label: string; onSelect: () => void };
    onDelete?: () => void;
    /** A clone of this row is being created. */
    busy?: boolean;
}

/** Everything a row can do, behind one button instead of a row of icons. Actions the user may not take are left out. */
export function ConnectionRowActions({ name, onExplore, onHistory, onEdit, onClone, counterpart, onDelete, busy = false }: ConnectionRowActionsProps) {
    const inspect = Boolean(onExplore || onHistory);
    const manage = Boolean(onEdit || onClone || counterpart);
    if (!inspect && !manage && !onDelete) return null;

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
                {onExplore && (
                    <DropdownMenuItem onSelect={onExplore}>
                        <SearchCode /> Explore databases
                    </DropdownMenuItem>
                )}
                {onHistory && (
                    <DropdownMenuItem onSelect={onHistory}>
                        <BarChart3 /> Storage history
                    </DropdownMenuItem>
                )}
                {inspect && manage && <DropdownMenuSeparator />}
                {onEdit && (
                    <DropdownMenuItem onSelect={onEdit}>
                        <Pencil /> Edit
                    </DropdownMenuItem>
                )}
                {onClone && (
                    <DropdownMenuItem onSelect={onClone} disabled={busy}>
                        <Copy /> Clone
                    </DropdownMenuItem>
                )}
                {counterpart && (
                    <DropdownMenuItem onSelect={counterpart.onSelect} disabled={busy}>
                        <ArrowLeftRight /> {counterpart.label}
                    </DropdownMenuItem>
                )}
                {onDelete && (
                    <>
                        {(inspect || manage) && <DropdownMenuSeparator />}
                        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                            <Trash /> Delete
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
