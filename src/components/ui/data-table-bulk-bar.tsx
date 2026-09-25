"use client";

import * as React from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { capitalize } from "@/components/ui/data-table-bulk-dialogs";
import type { BulkAction } from "@/components/ui/data-table-types";

interface DataTableBulkBarProps<TData> {
    selectedRows: TData[];
    /** The actions that apply to the selection, from `useBulkActions`. */
    actions: BulkAction<TData>[];
    runningId: string | null;
    onStart: (action: BulkAction<TData>) => void;
    onClearSelection: () => void;
    /**
     * "card" lays the bar over the toolbar of a card table, so the rows do not move down under
     * the pointer when the first one is ticked. It also groups menu actions under More.
     */
    variant?: "default" | "card";
}

/** Action bar shown while rows are selected. The work behind a button lives in `useBulkActions`. */
export function DataTableBulkBar<TData>({
    selectedRows,
    actions,
    runningId,
    onStart,
    onClearSelection,
    variant = "default",
}: DataTableBulkBarProps<TData>) {
    const visibleActions = actions;
    const labelOf = (action: BulkAction<TData>) => action.label?.(selectedRows) ?? defaultLabel(action, selectedRows.length);

    if (variant === "card") {
        const barActions = visibleActions.filter((action) => action.placement !== "menu");
        const menuGroups = groupMenuActions(visibleActions.filter((action) => action.placement === "menu"));
        return (
            <>
                {selectedRows.length > 0 && visibleActions.length > 0 && (
                    <div
                        role="toolbar"
                        aria-label="Actions for the selected rows"
                        className="absolute inset-0 z-10 flex flex-wrap items-center gap-1.5 bg-card px-4 py-3"
                    >
                        <span className="mr-1 inline-flex h-8 items-center rounded-lg bg-muted px-2.5 text-sm font-medium tabular-nums">
                            {selectedRows.length} selected
                        </span>
                        {barActions.map((action) => {
                            const Icon = action.icon;
                            return (
                                <Button
                                    key={action.id}
                                    size="sm"
                                    variant={action.variant === "destructive" ? "ghost-destructive" : "ghost"}
                                    disabled={runningId !== null}
                                    onClick={() => onStart(action)}
                                >
                                    {runningId === action.id ? <Loader2 className="animate-spin" /> : Icon && <Icon />}
                                    {labelOf(action)}
                                </Button>
                            );
                        })}
                        {menuGroups.length > 0 && (
                            <DropdownMenu modal={false}>
                                <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="ghost" disabled={runningId !== null}>
                                        {runningId !== null && menuGroups.some((group) => group.actions.some((action) => action.id === runningId)) && (
                                            <Loader2 className="animate-spin" />
                                        )}
                                        More
                                        <ChevronDown />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-64">
                                    {menuGroups.map((group, index) => (
                                        <React.Fragment key={group.label ?? `group-${index}`}>
                                            {index > 0 && <DropdownMenuSeparator />}
                                            {group.label && (
                                                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{group.label}</DropdownMenuLabel>
                                            )}
                                            {group.actions.map((action) => {
                                                const Icon = action.icon;
                                                return (
                                                    // The same entries as the right click menu of a selection, so they look the same.
                                                    <DropdownMenuItem
                                                        key={action.id}
                                                        onSelect={() => onStart(action)}
                                                        variant={action.variant === "destructive" ? "destructive" : "default"}
                                                        tone={action.variant === "destructive" ? "destructive" : "neutral"}
                                                    >
                                                        {Icon && <Icon />}
                                                        {labelOf(action)}
                                                    </DropdownMenuItem>
                                                );
                                            })}
                                        </React.Fragment>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                        <Button size="sm" variant="ghost" className="ml-auto" disabled={runningId !== null} onClick={onClearSelection}>
                            <X />
                            Clear
                        </Button>
                    </div>
                )}
            </>
        );
    }

    return (
        <>
            {selectedRows.length > 0 && visibleActions.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                    <span className="text-sm font-medium">
                        {selectedRows.length} selected
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                        {visibleActions.map((action) => {
                            const Icon = action.icon;
                            return (
                                <Button
                                    key={action.id}
                                    size="sm"
                                    variant={action.variant ?? "outline"}
                                    className="h-8"
                                    disabled={runningId !== null}
                                    onClick={() => onStart(action)}
                                >
                                    {Icon && <Icon className="mr-2 h-4 w-4" />}
                                    {action.label?.(selectedRows) ?? defaultLabel(action, selectedRows.length)}
                                </Button>
                            );
                        })}
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-8"
                        disabled={runningId !== null}
                        onClick={onClearSelection}
                    >
                        <X className="mr-2 h-4 w-4" />
                        Clear
                    </Button>
                </div>
            )}
        </>
    );
}

/** The More menu, one section per group in the order the groups first appear. */
function groupMenuActions<TData>(actions: BulkAction<TData>[]): { label?: string; actions: BulkAction<TData>[] }[] {
    const groups: { label?: string; actions: BulkAction<TData>[] }[] = [];
    for (const action of actions) {
        const group = groups.find((entry) => entry.label === action.group);
        if (group) group.actions.push(action);
        else groups.push({ label: action.group, actions: [action] });
    }
    return groups;
}

/** "Delete 3". Derived from the action's labels so call sites do not repeat the verb. */
function defaultLabel<TData>(action: BulkAction<TData>, count: number): string {
    return `${capitalize(action.labels.verb)} ${count}`;
}
