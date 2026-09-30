"use client";

import * as React from "react";
import { BulkConfirmDialog } from "@/components/ui/bulk-confirm-dialog";
import { BulkResultDialog } from "@/components/ui/bulk-result-dialog";
import type { DialogListItem } from "@/components/ui/confirm-dialog";
import type { BulkAction } from "@/components/ui/data-table-types";
import { PermanentNotice, PermanentTick, TrashNote, daysText, permanentTitle } from "@/components/ui/delete-mode";
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
    /** Delete it permanently now is ticked, for an action with `trash`. */
    permanently: boolean;
    onPermanentlyChange: (permanently: boolean) => void;
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * The confirmation of one bulk action, listing the rows it touches apart from the ones it leaves out.
 * A delete into Recently deleted asks in amber and says where the rows go, with the tick that
 * deletes them at once in red.
 */
export function BulkConfirmation<TData>({ action, partition, nameOf, isPending, permanently, onPermanentlyChange, onCancel, onConfirm }: BulkConfirmationProps<TData>) {
    const { labels, confirm, trash } = action;
    const rows = partition.eligible;
    const many = rows.length !== 1;
    const intoTrash = !!trash && !permanently;
    const title = confirm!.title(rows);
    const tick = trash?.canDeletePermanently && (
        <PermanentTick checked={permanently} onCheckedChange={onPermanentlyChange} many={many}>
            {trash.permanentLine?.(rows)}
        </PermanentTick>
    );
    return (
        <BulkConfirmDialog
            open
            onOpenChange={(open) => !open && onCancel()}
            title={trash && permanently ? permanentTitle(title) : title}
            note={intoTrash ? `Recently deleted keeps ${many ? "them" : "it"} for ${daysText(trash.days)}` : undefined}
            tone={intoTrash ? "warning" : undefined}
            description={confirm!.description?.(rows)}
            icon={action.icon}
            items={partition.eligible.map(
                (row, index): DialogListItem => ({ name: nameOf(action, row, index), detail: action.itemDetail?.(row), icon: action.itemIcon?.(row) })
            )}
            skipped={partition.skipped.map(
                ({ row, name, reason }): DialogListItem => ({ name, detail: reason, detailTone: "warning", icon: action.itemIcon?.(row) })
            )}
            itemsLabel={`Will be ${labels.verbPast}`}
            skippedLabel={`Will not be ${labels.verbPast}`}
            confirmLabel={`${confirm!.confirmLabel ?? capitalize(labels.verb)} ${countNoun(rows.length, labels)}${trash && permanently ? " permanently" : ""}`}
            destructive={action.variant === "destructive" && !intoTrash}
            isPending={isPending}
            onConfirm={onConfirm}
        >
            {trash && (intoTrash ? (
                <>
                    <TrashNote days={trash.days} many={many} />
                    {tick}
                </>
            ) : (
                <>
                    {tick}
                    <PermanentNotice>{many ? "They are gone at once. DBackup keeps no copy of them anywhere." : "It is gone at once. DBackup keeps no copy of it anywhere."}</PermanentNotice>
                </>
            ))}
        </BulkConfirmDialog>
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
