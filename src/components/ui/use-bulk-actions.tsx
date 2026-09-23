"use client";

import * as React from "react";
import { toast } from "sonner";
import { BulkConfirmation, BulkFailures, type BulkOutcome, type BulkPartition } from "@/components/ui/data-table-bulk-dialogs";
import type { BulkAction } from "@/components/ui/data-table-types";
import { summarizeBulkResult, BULK_REQUEST_LIMIT, type BulkResult } from "@/lib/core/bulk";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "useBulkActions" });

interface BulkActionsOptions<TData> {
    selectedRows: TData[];
    actions: BulkAction<TData>[];
    onClearSelection: () => void;
    onComplete?: () => void | Promise<void>;
    /** The table's row ids, which put the icons of the rows back beside the failures. */
    getRowId?: (row: TData, index: number) => string;
}

export interface BulkActions<TData> {
    /** The actions that apply to the current selection. */
    visibleActions: BulkAction<TData>[];
    /** The action running right now, for a spinner on its button. */
    runningId: string | null;
    /** Starts one action: confirm when it asks for it, otherwise run it. */
    start: (action: BulkAction<TData>) => void;
    /** The confirmation and the failure list, rendered once by the table. */
    dialogs: React.ReactNode;
}

/**
 * The whole sequence behind a bulk action - confirm, run, split the partial result, report,
 * clear, refetch - so that no call site re-derives it. In particular it deliberately avoids
 * `toast.promise`, the pattern used for single-row actions elsewhere: that collapses a
 * result into success or failure and would silently swallow the failed half of a batch.
 *
 * The bar and the right click menu of a selected row both drive it, which is why it is a
 * hook and not part of either.
 */
export function useBulkActions<TData>({
    selectedRows,
    actions,
    onClearSelection,
    onComplete,
    getRowId,
}: BulkActionsOptions<TData>): BulkActions<TData> {
    const [pendingAction, setPendingAction] = React.useState<BulkAction<TData> | null>(null);
    const [runningId, setRunningId] = React.useState<string | null>(null);
    const [outcome, setOutcome] = React.useState<BulkOutcome<TData> | null>(null);

    const nameOf = React.useCallback(
        (action: BulkAction<TData>, row: TData, index: number) =>
            action.itemName?.(row) ?? `Item ${index + 1}`,
        []
    );

    /** Splits the selection into what this action will touch and what it skips. */
    const partition = React.useCallback(
        (action: BulkAction<TData>): BulkPartition<TData> => {
            const eligible: TData[] = [];
            const skipped: BulkPartition<TData>["skipped"] = [];
            selectedRows.forEach((row, index) => {
                const reason = action.ineligible?.(row) ?? null;
                if (reason) skipped.push({ row, name: nameOf(action, row, index), reason });
                else eligible.push(row);
            });
            return { eligible, skipped };
        },
        [selectedRows, nameOf]
    );

    const report = React.useCallback((action: BulkAction<TData>, result: BulkResult, rows: TData[]) => {
        const succeeded = result.succeeded.length;
        const failed = result.failed.length;
        const summary = summarizeBulkResult(result, action.labels);

        if (failed === 0) {
            toast.success(summary);
            return;
        }

        const showDetails = () => setOutcome({ action, result, rows });

        if (succeeded === 0 && failed === 1) {
            // A single failure has room for its actual reason, which beats a count.
            toast.error(result.failed[0].error);
            return;
        }

        if (succeeded === 0) {
            toast.error(summary, { action: { label: "Details", onClick: showDetails } });
            return;
        }

        toast.warning(summary, {
            action: {
                label: failed === 1 ? "Show 1 failure" : `Show ${failed} failures`,
                onClick: showDetails,
            },
        });
    }, []);

    const execute = React.useCallback(
        async (action: BulkAction<TData>, rows: TData[]) => {
            setRunningId(action.id);
            try {
                const result = await action.run(rows);
                report(action, result, rows);
                if (result.succeeded.length > 0) onClearSelection();
            } catch (error: unknown) {
                // The action itself failed rather than any single row. Nothing is known
                // about what got through, so the selection stays put for a retry.
                log.error("Bulk action failed", { actionId: action.id }, error instanceof Error ? error : new Error(String(error)));
                toast.error(error instanceof Error ? error.message : "The action could not be completed.");
            } finally {
                setRunningId(null);
                setPendingAction(null);
                await onComplete?.();
            }
        },
        [report, onClearSelection, onComplete]
    );

    const start = React.useCallback(
        (action: BulkAction<TData>) => {
            const { eligible, skipped } = partition(action);

            if (eligible.length === 0) {
                // One entry is named, so the reason is not left without its subject.
                toast.error(
                    skipped.length === 1
                        ? `${skipped[0].name}: ${skipped[0].reason}`
                        : skipped[0]?.reason ?? "None of the selected entries can be used for this action."
                );
                return;
            }
            if (eligible.length > BULK_REQUEST_LIMIT) {
                toast.error(`Select at most ${BULK_REQUEST_LIMIT} entries for one action.`);
                return;
            }

            if (action.confirm) setPendingAction(action);
            else void execute(action, eligible);
        },
        [partition, execute]
    );

    const visibleActions = actions.filter((action) => action.isAvailable?.(selectedRows) ?? true);
    const confirmState = pendingAction ? partition(pendingAction) : null;

    const dialogs = (
        <>
            {pendingAction && confirmState && (
                <BulkConfirmation
                    action={pendingAction}
                    partition={confirmState}
                    nameOf={nameOf}
                    isPending={runningId === pendingAction.id}
                    onCancel={() => setPendingAction(null)}
                    onConfirm={() => void execute(pendingAction, confirmState.eligible)}
                />
            )}
            {outcome && <BulkFailures outcome={outcome} getRowId={getRowId} onClose={() => setOutcome(null)} />}
        </>
    );

    return { visibleActions, runningId, start, dialogs };
}
