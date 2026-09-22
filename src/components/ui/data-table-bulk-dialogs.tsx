"use client";

import * as React from "react";
import { BulkConfirmDialog } from "@/components/ui/bulk-confirm-dialog";
import { BulkResultDialog } from "@/components/ui/bulk-result-dialog";
import type { DialogListItem } from "@/components/ui/confirm-dialog";
import type { BulkAction } from "@/components/ui/data-table-types";
import { countNoun, describeBulkFailures, type BulkResult } from "@/lib/core/bulk";

/** A selection split by one action: the rows it touches, and the rows it leaves out with the reason. */
export interface BulkPartition<TData> {
    eligible: TData[];
    skipped: { row: TData; name: string; reason: string }[];
}

/** What a finished bulk action reports, kept for the failure list. */
export interface BulkOutcome<TData> {
    action: BulkAction<TData>;
    result: BulkResult;
    rows: TData[];
}

interface BulkConfirmationProps<TData> {
    action: BulkAction<TData>;
    partition: BulkPartition<TData>;
    nameOf: (action: BulkAction<TData>, row: TData, index: number) => string;
    isPending: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

/** The confirmation of one bulk action, listing the rows it touches apart from the ones it leaves out. */
export function BulkConfirmation<TData>({ action, partition, nameOf, isPending, onCancel, onConfirm }: BulkConfirmationProps<TData>) {
    const { labels, confirm } = action;
    return (
        <BulkConfirmDialog
            open
            onOpenChange={(open) => !open && onCancel()}
            title={confirm!.title(partition.eligible)}
            description={confirm!.description?.(partition.eligible)}
            icon={action.icon}
            items={partition.eligible.map(
                (row, index): DialogListItem => ({ name: nameOf(action, row, index), detail: action.itemDetail?.(row), icon: action.itemIcon?.(row) })
            )}
            skipped={partition.skipped.map(
                ({ row, name, reason }): DialogListItem => ({ name, detail: reason, detailTone: "warning", icon: action.itemIcon?.(row) })
            )}
            itemsLabel={`Will be ${labels.verbPast}`}
            skippedLabel={`Will not be ${labels.verbPast}`}
            confirmLabel={`${confirm!.confirmLabel ?? capitalize(labels.verb)} ${countNoun(partition.eligible.length, labels)}`}
            destructive={action.variant === "destructive"}
            isPending={isPending}
            onConfirm={onConfirm}
        />
    );
}

interface BulkFailuresProps<TData> {
    outcome: BulkOutcome<TData>;
    /** The table's row ids, which put the icons of the rows back beside the failures. */
    getRowId?: (row: TData, index: number) => string;
    onClose: () => void;
}

/** The rows a bulk action could not process, each with its reason. */
export function BulkFailures<TData>({ outcome, getRowId, onClose }: BulkFailuresProps<TData>) {
    const { action, result, rows } = outcome;
    const byId = new Map(getRowId ? rows.map((row, index) => [getRowId(row, index), row]) : []);
    const failures = result.failed.map((failure): DialogListItem => {
        const row = byId.get(failure.id);
        return {
            name: failure.name ?? (row && action.itemName?.(row)) ?? failure.id,
            description: failure.error,
            icon: row && action.itemIcon?.(row),
        };
    });

    return (
        <BulkResultDialog
            open
            onOpenChange={(open) => !open && onClose()}
            {...describeBulkFailures(result, action.labels)}
            failures={failures}
        />
    );
}

export function capitalize(text: string): string {
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
