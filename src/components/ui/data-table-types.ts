import * as React from "react";
import type { BulkLabels, BulkResult } from "@/lib/core/bulk";

/**
 * Types shared between DataTable and its parts.
 *
 * They live apart from `data-table.tsx` because the toolbar and the bulk bar need them
 * while `data-table.tsx` imports those components, which would otherwise be a cycle.
 * Everything here is re-exported from `data-table.tsx`, so consumers import from there.
 */

export interface DataTableFilterOption {
    label: string
    value: string
    icon?: React.ComponentType<{ className?: string }>
    count?: number
}

export interface DataTableFilterableColumn<TData> {
    id: keyof TData | string;
    title: string;
    options: DataTableFilterOption[];
}

/**
 * One button in the bulk action bar, plus everything needed to run it safely.
 *
 * Declarative rather than a render prop on purpose: the sequence around the button -
 * confirm, run, split the partial result, toast, clear the selection, refetch - is
 * identical at every call site and belongs in one place.
 */
export interface BulkAction<TData> {
    /** Stable key. Also the React key. */
    id: string;
    /**
     * Names the verb and the noun for this action, used for both the button and the
     * result summary. `{ verb: "delete", verbPast: "deleted", noun: "job" }` gives a
     * "Delete 3" button and a "3 jobs deleted" toast.
     */
    labels: BulkLabels;
    /** Overrides the button text when the default "Verb N" does not fit. */
    label?: (rows: TData[]) => string;
    icon?: React.ComponentType<{ className?: string }>;
    variant?: "outline" | "destructive";
    /**
     * Omit for an action that runs straight away, such as enabling.
     * Present for anything destructive - the design system requires a confirmation there.
     */
    confirm?: {
        title: (rows: TData[]) => string;
        description: (rows: TData[]) => React.ReactNode;
        confirmLabel?: string;
    };
    /**
     * Per-row veto for this one action. Returns the reason, or null when the row is fine.
     *
     * Distinct from the table-level `isRowSelectable`: an ineligible row stays selectable
     * because another action may still apply to it. A locked backup can be unlocked but
     * not deleted. Ineligible rows are listed in the confirmation and never sent.
     */
    ineligible?: (row: TData) => string | null;
    /** Hides the button entirely, for example when no selected row would change. */
    isAvailable?: (rows: TData[]) => boolean;
    /**
     * "menu" puts the action into the More menu of the bar, for settings that would crowd it.
     * Only the card look of DataTable has that menu. The default look shows every action as a button.
     */
    placement?: "bar" | "menu";
    /** Heading of the section in the More menu. Actions with the same group sit together. */
    group?: string;
    /** Names a row for the confirmation preview and the failure list. */
    itemName?: (row: TData) => string;
    /** A small icon before the name in the confirmation, such as the brand of a connection. */
    itemIcon?: (row: TData) => React.ComponentType<{ className?: string }>;
    /** A short muted fact after the name in the confirmation, such as the type of a connection. */
    itemDetail?: (row: TData) => string;
    /** Performs the action. Reports per-row outcomes rather than throwing on the first failure. */
    run: (rows: TData[]) => Promise<BulkResult>;
}
