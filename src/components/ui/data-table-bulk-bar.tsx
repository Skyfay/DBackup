"use client";

import * as React from "react";
import { toast } from "sonner";
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
import { cn } from "@/lib/utils";
import { BulkConfirmation, BulkFailures, capitalize, type BulkOutcome, type BulkPartition } from "@/components/ui/data-table-bulk-dialogs";
import type { BulkAction } from "@/components/ui/data-table-types";
import { summarizeBulkResult, BULK_REQUEST_LIMIT, type BulkResult } from "@/lib/core/bulk";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "DataTableBulkBar" });

interface DataTableBulkBarProps<TData> {
    selectedRows: TData[];
    actions: BulkAction<TData>[];
    onClearSelection: () => void;
    onComplete?: () => void | Promise<void>;
    /** The table's row ids, which put the icons of the rows back beside the failures. */
    getRowId?: (row: TData, index: number) => string;
    /**
     * "card" lays the bar over the toolbar of a card table, so the rows do not move down under
     * the pointer when the first one is ticked. It also groups menu actions under More.
     */
    variant?: "default" | "card";
}

/**
 * Action bar shown while rows are selected.
 *
 * It owns the whole sequence - confirm, run, split the partial result, report, clear,
 * refetch - so that no call site re-derives it. In particular it deliberately avoids
 * `toast.promise`, the pattern used for single-row actions elsewhere: that collapses a
 * result into success or failure and would silently swallow the failed half of a batch.
 */
export function DataTableBulkBar<TData>({
    selectedRows,
    actions,
    onClearSelection,
    onComplete,
    getRowId,
    variant = "default",
}: DataTableBulkBarProps<TData>) {
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
    const labelOf = (action: BulkAction<TData>) => action.label?.(selectedRows) ?? defaultLabel(action, selectedRows.length);

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
                                    variant="ghost"
                                    className={cn(action.variant === "destructive" && "text-destructive hover:bg-destructive/10 hover:text-destructive")}
                                    disabled={runningId !== null}
                                    onClick={() => start(action)}
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
                                                    <DropdownMenuItem key={action.id} onSelect={() => start(action)}>
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
                {dialogs}
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
                                    onClick={() => start(action)}
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

            {dialogs}
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
