import type { ColumnDef, RowData } from "@tanstack/react-table";
import type { TableDensity, TablePreferences } from "@/lib/core/table-preferences";

declare module "@tanstack/react-table" {
    // The generics have to match TanStack's declaration for the merge to work.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData extends RowData, TValue> {
        /** Name in the column menu. Falls back to the header when that is a string. */
        label?: string;
        /** "start" keeps a column in front, "end" at the back. A pinned column can not be moved or hidden. */
        pin?: "start" | "end";
        /** Starts switched off until the user turns it on in the column menu. */
        defaultHidden?: boolean;
        /** Never shown and left out of the column menu. It only exists for a filter to work on. */
        filterOnly?: boolean;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface TableMeta<TData extends RowData> {
        /** The row height picked in the column menu, for cells that lay out differently when compact. */
        density?: TableDensity;
    }
}

/** A column as the column menu sees it. */
export interface LayoutColumn {
    id: string;
    label: string;
    pin?: "start" | "end";
    defaultHidden?: boolean;
    filterOnly?: boolean;
}

/** The layout a table renders with: the movable columns in order, and the ones switched off. */
export interface ColumnLayout {
    order: string[];
    hidden: string[];
    density: TableDensity;
}

/** TanStack derives a column's id from its accessor key when it has no explicit id. */
export function columnId<TData, TValue>(column: ColumnDef<TData, TValue>): string {
    return column.id ?? (column as { accessorKey?: string }).accessorKey ?? "";
}

export function layoutColumns<TData, TValue>(columns: ColumnDef<TData, TValue>[]): LayoutColumn[] {
    return columns.map((column) => {
        const id = columnId(column);
        return {
            id,
            label: column.meta?.label ?? (typeof column.header === "string" ? column.header : id),
            pin: column.meta?.pin,
            defaultHidden: column.meta?.defaultHidden,
            filterOnly: column.meta?.filterOnly,
        };
    });
}

/**
 * Applies a saved layout to the current columns. Ids that no longer exist are dropped, and
 * a column added since the layout was saved takes its default place and visibility at the end.
 */
export function resolveLayout(columns: LayoutColumn[], saved: TablePreferences | null): ColumnLayout {
    const movable = columns.filter((column) => !column.pin && !column.filterOnly);
    const known = new Set(movable.map((column) => column.id));
    const defaultHidden = movable.filter((column) => column.defaultHidden).map((column) => column.id);
    if (!saved) return { order: movable.map((column) => column.id), hidden: defaultHidden, density: "comfortable" };

    const savedOrder = saved.order.filter((id) => known.has(id));
    const added = movable.filter((column) => !savedOrder.includes(column.id));
    return {
        order: [...savedOrder, ...added.map((column) => column.id)],
        hidden: [
            ...saved.hidden.filter((id) => known.has(id)),
            ...added.filter((column) => column.defaultHidden).map((column) => column.id),
        ],
        density: saved.density,
    };
}

/** Moves one column to a new position among the movable ones. */
export function moveColumn(order: string[], id: string, toIndex: number): string[] {
    const from = order.indexOf(id);
    if (from === -1) return order;
    const target = Math.max(0, Math.min(order.length - 1, toIndex));
    if (target === from) return order;
    const next = order.filter((entry) => entry !== id);
    next.splice(target, 0, id);
    return next;
}

/** True when a layout matches what the columns start with, so nothing needs to be stored. */
export function isDefaultLayout(columns: LayoutColumn[], layout: ColumnLayout): boolean {
    const initial = resolveLayout(columns, null);
    return (
        layout.density === initial.density &&
        layout.order.join() === initial.order.join() &&
        [...layout.hidden].sort().join() === [...initial.hidden].sort().join()
    );
}

/** The full TanStack column order: pinned columns around the movable ones, the row checkbox first. */
export function tanstackOrder(columns: LayoutColumn[], layout: ColumnLayout, withSelect: boolean): string[] {
    const start = columns.filter((column) => column.pin === "start").map((column) => column.id);
    const end = columns.filter((column) => column.pin === "end").map((column) => column.id);
    const filterOnly = columns.filter((column) => column.filterOnly).map((column) => column.id);
    return [...(withSelect ? ["select"] : []), ...start, ...layout.order, ...end, ...filterOnly];
}

/** What TanStack hides: the columns switched off plus the ones that only serve a filter. */
export function tanstackVisibility(columns: LayoutColumn[], layout: ColumnLayout): Record<string, boolean> {
    const hidden = [...layout.hidden, ...columns.filter((column) => column.filterOnly).map((column) => column.id)];
    return Object.fromEntries(hidden.map((id) => [id, false]));
}
