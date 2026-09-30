"use client";

import * as React from "react";
import { ConfirmDialog, DialogItemList, type DialogListItem } from "@/components/ui/confirm-dialog";
import type { Tone } from "@/components/ui/tone";

export interface BulkConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: React.ReactNode;
    icon?: React.ComponentType<{ className?: string }>;
    /** The rows that will be acted on. */
    items: DialogListItem[];
    /** Rows this action leaves out, each with the reason as its detail. Shown so the count is never a surprise. */
    skipped?: DialogListItem[];
    /** Headings of the two lists, shown once some rows are left out. For example "Will be deleted". */
    itemsLabel: string;
    skippedLabel: string;
    confirmLabel?: string;
    destructive?: boolean;
    /** The tone of a confirmation that is not destructive, like warning for a delete into Recently deleted. */
    tone?: Tone;
    /** The line under the title. A destructive one says it cannot be undone when left out. */
    note?: string;
    isPending?: boolean;
    onConfirm: () => void;
    /** More below the lists, like where deleted rows go. */
    children?: React.ReactNode;
}

/**
 * Confirmation for an action about to touch several rows.
 *
 * Lists the rows by name rather than only counting them, because a selection can be
 * changed by a filter after it was made and a bare count would not show that. Rows the
 * action leaves out get a list of their own, so it is clear beforehand what happens.
 */
export function BulkConfirmDialog({ items, skipped = [], itemsLabel, skippedLabel, destructive, note, children, ...props }: BulkConfirmDialogProps) {
    return (
        <ConfirmDialog {...props} destructive={destructive} note={note ?? (destructive ? "Cannot be undone" : undefined)} disabled={items.length === 0}>
            {skipped.length === 0 ? (
                <DialogItemList items={items} />
            ) : (
                <>
                    {items.length > 0 && <ItemGroup label={itemsLabel} items={items} />}
                    <ItemGroup label={skippedLabel} items={skipped} size="small" />
                </>
            )}
            {children}
        </ConfirmDialog>
    );
}

function ItemGroup({ label, items, size }: { label: string; items: DialogListItem[]; size?: "default" | "small" }) {
    return (
        <div className="grid min-w-0 gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">
                {label} <span className="tabular-nums">· {items.length}</span>
            </p>
            <DialogItemList items={items} size={size} />
        </div>
    );
}
