"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { TableDensity, TablePreferences } from "@/lib/core/table-preferences";
import {
    isDefaultLayout,
    layoutColumns,
    moveColumn,
    resolveLayout,
    tanstackOrder,
    tanstackVisibility,
    type ColumnLayout,
} from "./data-table-layout";

export interface ColumnLayoutOption {
    /** The layout saved for this user, null for the defaults. */
    initial: TablePreferences | null;
    /** Called on every change, with null once the layout matches the defaults again. */
    onChange: (next: TablePreferences | null) => void;
}

/**
 * Holds the column layout of one DataTable: order, visibility and row height, plus the drag
 * state for moving columns by their header. Returns null when the table has no Columns menu.
 */
export function useColumnLayout<TData, TValue>(
    columns: ColumnDef<TData, TValue>[],
    option: ColumnLayoutOption | undefined,
    withSelect: boolean,
) {
    const described = React.useMemo(() => layoutColumns(columns), [columns]);
    const [layout, setLayout] = React.useState<ColumnLayout>(() => resolveLayout(described, option?.initial ?? null));
    const [drag, setDrag] = React.useState<{ id: string; over: string | null } | null>(null);

    if (!option) return null;

    // Resolved on every render, so a column that appears or disappears never leaves a gap.
    const current = resolveLayout(described, layout);
    const labels = new Map(described.map((column) => [column.id, column.label]));

    const update = (next: ColumnLayout) => {
        setLayout(next);
        option.onChange(isDefaultLayout(described, next) ? null : next);
    };
    const move = (id: string, toIndex: number) => update({ ...current, order: moveColumn(current.order, id, toIndex) });

    return {
        density: current.density,
        columnOrder: tanstackOrder(described, current, withSelect),
        columnVisibility: tanstackVisibility(described, current),
        // Filter-only columns are hidden by TanStack as well, they never belong in the saved layout.
        setHidden: (hidden: string[]) => update({ ...current, hidden: hidden.filter((id) => current.order.includes(id)) }),
        settings: {
            columns: current.order.map((id) => ({ id, label: labels.get(id) ?? id, visible: !current.hidden.includes(id) })),
            pinned: described.filter((column) => column.pin === "start").map((column) => column.label),
            density: current.density,
            isCustomized: !isDefaultLayout(described, current),
            onToggle: (id: string) =>
                update({
                    ...current,
                    hidden: current.hidden.includes(id) ? current.hidden.filter((entry) => entry !== id) : [...current.hidden, id],
                }),
            onMove: move,
            onDensityChange: (density: TableDensity) => update({ ...current, density }),
            onReset: () => {
                setLayout(resolveLayout(described, null));
                option.onChange(null);
            },
        },
        /** Drag props for a header cell. Pinned columns stay where they are. */
        headerDrag: (id: string) => {
            if (!current.order.includes(id)) return {};
            return {
                draggable: true,
                "data-drop-target": drag && drag.over === id && drag.id !== id ? true : undefined,
                onDragStart: (event: React.DragEvent) => {
                    setDrag({ id, over: null });
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", id);
                },
                onDragOver: (event: React.DragEvent) => {
                    if (!drag) return;
                    event.preventDefault();
                    if (drag.over !== id) setDrag({ ...drag, over: id });
                },
                onDrop: (event: React.DragEvent) => {
                    event.preventDefault();
                    if (drag && drag.id !== id) move(drag.id, current.order.indexOf(id));
                    setDrag(null);
                },
                onDragEnd: () => setDrag(null),
            };
        },
    };
}
