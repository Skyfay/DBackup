"use client";

import * as React from "react";
import { Columns3, GripVertical, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { TableDensity } from "@/lib/core/table-preferences";

interface SettingsColumn {
    id: string;
    label: string;
    visible: boolean;
}

interface DataTableColumnSettingsProps {
    /** The movable columns in their current order. */
    columns: SettingsColumn[];
    /** Labels of the columns pinned to the front, listed first and locked. */
    pinned: string[];
    density: TableDensity;
    isCustomized: boolean;
    onToggle: (id: string) => void;
    onMove: (id: string, toIndex: number) => void;
    onDensityChange: (density: TableDensity) => void;
    onReset: () => void;
    /** Cards have no row height, so their Columns menu leaves the switch out. */
    showDensity?: boolean;
}

/**
 * The Columns menu: switch columns on and off, drag them into order, pick the row height.
 * Dragging has a keyboard twin, the arrow keys on a column's grip.
 */
export function DataTableColumnSettings({
    columns,
    pinned,
    density,
    isCustomized,
    onToggle,
    onMove,
    onDensityChange,
    onReset,
    showDensity = true,
}: DataTableColumnSettingsProps) {
    const [dragId, setDragId] = React.useState<string | null>(null);
    const [overId, setOverId] = React.useState<string | null>(null);
    const grips = React.useRef(new Map<string, HTMLButtonElement>());
    const hintId = React.useId();
    const visible = columns.filter((column) => column.visible).length + pinned.length;

    const moveWithKeys = (event: React.KeyboardEvent, id: string, index: number) => {
        const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        if (step === 0) return;
        event.preventDefault();
        onMove(id, index + step);
        // The row moves in the DOM, so focus is put back on its grip afterwards.
        requestAnimationFrame(() => grips.current.get(id)?.focus());
    };

    const endDrag = () => {
        setDragId(null);
        setOverId(null);
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                    <Columns3 />
                    Columns
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">
                        {visible}/{columns.length + pinned.length}
                    </span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-76 p-2">
                <div className="flex items-start justify-between gap-2 px-2 pt-1.5 pb-2.5">
                    <div>
                        <p className="text-sm font-semibold">Columns</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Drag to reorder. Saved to your account.</p>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onReset} disabled={!isCustomized}>
                        Reset
                    </Button>
                </div>
                <div className="-mx-2 border-t" />
                <ul className="py-1">
                    {pinned.map((label) => (
                        <li key={label} className="flex h-8 items-center gap-2.5 px-2 text-sm text-muted-foreground">
                            <Pin className="size-3.5" aria-hidden="true" />
                            {label}
                            <span className="ml-auto text-xs">Always first</span>
                        </li>
                    ))}
                    {columns.map((column, index) => {
                        const checkboxId = `${hintId}-${column.id}`;
                        return (
                            <li
                                key={column.id}
                                draggable
                                onDragStart={(event) => {
                                    setDragId(column.id);
                                    event.dataTransfer.effectAllowed = "move";
                                    event.dataTransfer.setData("text/plain", column.id);
                                }}
                                onDragOver={(event) => {
                                    if (!dragId) return;
                                    event.preventDefault();
                                    if (overId !== column.id) setOverId(column.id);
                                }}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    if (dragId && dragId !== column.id) onMove(dragId, index);
                                    endDrag();
                                }}
                                onDragEnd={endDrag}
                                className={cn(
                                    "flex h-8 items-center gap-1.5 rounded-md pr-2 transition-colors",
                                    dragId === column.id && "opacity-50",
                                    overId === column.id && dragId !== column.id && "bg-muted"
                                )}
                            >
                                <button
                                    type="button"
                                    ref={(node) => {
                                        if (node) grips.current.set(column.id, node);
                                        else grips.current.delete(column.id);
                                    }}
                                    aria-label={`Move ${column.label}`}
                                    aria-describedby={hintId}
                                    onKeyDown={(event) => moveWithKeys(event, column.id, index)}
                                    className="flex size-7 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
                                >
                                    <GripVertical className="size-3.5" aria-hidden="true" />
                                </button>
                                <Checkbox id={checkboxId} checked={column.visible} onCheckedChange={() => onToggle(column.id)} />
                                <label htmlFor={checkboxId} className="flex-1 cursor-pointer pl-1 text-sm">
                                    {column.label}
                                </label>
                            </li>
                        );
                    })}
                </ul>
                <span id={hintId} className="sr-only">Use the arrow keys to move the column up or down.</span>
                {showDensity && (
                    <>
                        <div className="-mx-2 border-t" />
                        <div className="flex items-center justify-between gap-2 px-2 pt-2.5 pb-1">
                            <span className="text-xs text-muted-foreground">Row height</span>
                            <Tabs value={density} onValueChange={(value) => onDensityChange(value as TableDensity)}>
                                <TabsList className="h-7">
                                    <TabsTrigger value="comfortable" className="px-2 text-xs">Comfortable</TabsTrigger>
                                    <TabsTrigger value="compact" className="px-2 text-xs">Compact</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </div>
                    </>
                )}
            </PopoverContent>
        </Popover>
    );
}
