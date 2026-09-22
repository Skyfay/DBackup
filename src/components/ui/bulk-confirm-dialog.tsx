"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { ConfirmDialog, DialogItemList, type DialogListItem } from "@/components/ui/confirm-dialog";

/** How many skipped rows to name before summarising the rest. */
const SKIPPED_PREVIEW = 8;

export interface BulkConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: React.ReactNode;
    icon?: React.ComponentType<{ className?: string }>;
    /** The rows that will be acted on. */
    items: DialogListItem[];
    /** Rows this action skips, with the reason. Shown so the count is never a surprise. */
    skipped?: { name: string; reason: string }[];
    confirmLabel?: string;
    destructive?: boolean;
    isPending?: boolean;
    onConfirm: () => void;
}

/**
 * Confirmation for an action about to touch several rows.
 *
 * Lists the rows by name rather than only counting them, because a selection can be
 * changed by a filter after it was made and a bare count would not show that.
 */
export function BulkConfirmDialog({ items, skipped = [], ...props }: BulkConfirmDialogProps) {
    return (
        <ConfirmDialog {...props} disabled={items.length === 0}>
            {items.length > 0 && <DialogItemList items={items} />}

            {skipped.length > 0 && (
                <div className="min-w-0 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
                    <p className="flex items-center gap-2 font-medium text-warning">
                        <AlertTriangle className="size-4 shrink-0" />
                        {skipped.length} will be skipped
                    </p>
                    <ul className="mt-1 min-w-0 space-y-0.5 text-muted-foreground">
                        {skipped.slice(0, SKIPPED_PREVIEW).map((entry, index) => (
                            // The reason is the useful half, so the name gives way
                            // rather than the two sharing the truncation.
                            <li key={index} className="flex min-w-0 items-baseline gap-1.5">
                                <span className="truncate text-foreground">{entry.name}</span>
                                <span className="shrink-0">· {entry.reason}</span>
                            </li>
                        ))}
                        {skipped.length > SKIPPED_PREVIEW && <li>and {skipped.length - SKIPPED_PREVIEW} more</li>}
                    </ul>
                </div>
            )}
        </ConfirmDialog>
    );
}
