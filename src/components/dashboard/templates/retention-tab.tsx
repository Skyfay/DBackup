"use client";

import { useCallback, useImperativeHandle, useMemo, useState } from "react";
import { ListChecks, Trash } from "lucide-react";
import { createRetentionPolicy } from "@/app/actions/templates";
import { bulkDeleteRetentionPolicies } from "@/app/actions/templates-bulk";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { RetentionPolicyDialog } from "@/components/settings/templates/retention-policy-dialog";
import { describeConfig, keepsPhrase } from "@/components/templates/retention-words";
import type { BulkAction } from "@/components/ui/data-table";
import { useTableLayout } from "@/hooks/use-table-layout";
import { unwrapBulkAction } from "@/lib/bulk-request";
import type { RetentionRow } from "@/services/templates/templates-types";
import { RetentionDefaultDialog } from "./retention-default-dialog";
import { RetentionDetails } from "./retention-details";
import { policySub, reachOf, retentionColumns, retentionFilters, TierBar } from "./retention-columns";
import { templateActions, type TemplateActionHandlers } from "./template-actions";
import { TemplateCard } from "./template-card";
import { BuiltInBadge, DefaultBadge, DestinationStack, KindTile } from "./template-cells";
import { RetentionDeleteDialog } from "./template-delete-dialogs";
import { TemplateDuplicateDialog } from "./template-duplicate-dialog";
import { count, jobsById } from "./template-format";
import { RetentionStrip } from "./template-strips";
import { TemplateTable } from "./template-table";
import type { TemplateTabProps } from "./template-tab-props";
import { TEMPLATE_TABLE_IDS } from "./template-tables";

/** Why a policy cannot be deleted yet, or null. The server refuses it the same way. */
function retentionBlocker(row: RetentionRow): string | null {
    if (row.isSystem) return "Built in, it can be edited instead";
    if (row.isDefault) return "The default, make another one the default first";
    const holders = row.uses.filter((use) => use.how === "picked").length + row.prefills.length;
    return holders > 0 ? `${count(holders, "destination")} still ${holders === 1 ? "uses" : "use"} it` : null;
}

const inUse = (row: RetentionRow) => row.uses.length + row.prefills.length > 0;

/**
 * The retention policies: the numbers, the list, a panel with what a policy keeps and where, and
 * every dialog of a policy. A phone gets cards.
 */
export function RetentionTab({ ref, model, isLoading, refresh, afterChange, cards, canManage, initialLayout }: TemplateTabProps) {
    const layout = useTableLayout(TEMPLATE_TABLE_IDS.retention, initialLayout);
    // The id stays after closing, so the panel keeps its content while it slides out.
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [form, setForm] = useState<{ open: boolean; policy?: RetentionRow }>({ open: false });
    const [defaulting, setDefaulting] = useState<RetentionRow | null>(null);
    const [copying, setCopying] = useState<RetentionRow | null>(null);
    const [removing, setRemoving] = useState<RetentionRow | null>(null);

    useImperativeHandle(ref, () => ({ openCreate: () => setForm({ open: true }) }), []);

    const rows = model?.retention ?? null;
    const jobs = useMemo(() => jobsById(model?.jobs ?? []), [model]);
    const jobNames = useMemo(() => new Map([...jobs.values()].map((job) => [job.id, job.name])), [jobs]);

    const handlers = useMemo<TemplateActionHandlers<RetentionRow>>(() => canManage ? {
        onEdit: (row) => setForm({ open: true, policy: row }),
        onDefault: setDefaulting,
        onDuplicate: setCopying,
        onDelete: setRemoving,
    } : {}, [canManage]);

    const actionsOf = useCallback(
        (row: RetentionRow, inPanel = false) => templateActions(row, handlers, { isDefault: row.isDefault, defaultTone: "warning", inPanel }),
        [handlers]
    );
    const open = useCallback((row: RetentionRow) => setDetails({ id: row.id, open: true }), []);
    const columns = useMemo(() => retentionColumns({ onOpen: open, renderActions: (row) => <BackupRowMenu name={row.name} groups={actionsOf(row)} /> }), [open, actionsOf]);
    const filters = useMemo(() => retentionFilters(rows ?? []), [rows]);
    const bulkActions = useMemo<BulkAction<RetentionRow>[]>(() => canManage ? [{
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "retention policy", nounPlural: "retention policies" },
        icon: Trash,
        variant: "destructive",
        itemName: (row) => row.name,
        itemDetail: (row) => describeConfig(row.config),
        // Built-in and default policies, and the ones destinations picked, are listed apart and never sent.
        ineligible: retentionBlocker,
        confirm: {
            title: (selected) => `Delete ${count(selected.length, "retention policy", "retention policies")}?`,
            confirmLabel: "Delete",
        },
        run: (selected) => unwrapBulkAction(bulkDeleteRetentionPolicies(selected.map((row) => row.id))),
    }] : [], [canManage]);

    const shown = details && rows ? rows.find((row) => row.id === details.id) ?? null : null;
    const done = (after: () => void) => () => {
        after();
        afterChange();
    };

    return (
        <div className="space-y-4 md:space-y-0">
            <RetentionStrip model={model} />

            <TemplateTable
                rows={rows}
                isLoading={isLoading}
                onRefresh={refresh}
                columns={columns}
                filters={filters}
                searchPlaceholder="Search policies"
                inUse={inUse}
                loadingLabel="Loading retention policies"
                cards={cards}
                selectable={canManage}
                bulkActions={bulkActions}
                onBulkActionComplete={afterChange}
                layout={layout}
                onOpen={open}
                renderCard={(row) => (
                    <TemplateCard
                        kind="retention"
                        name={row.name}
                        sub={policySub(row)}
                        badges={(row.isDefault || row.isSystem) && <>{row.isDefault && <DefaultBadge />}{row.isSystem && <BuiltInBadge />}</>}
                        what={<><span>{describeConfig(row.config)}</span><TierBar config={row.config} /></>}
                        usage={<><DestinationStack uses={row.uses} />{row.uses.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{reachOf(row)}</p>}</>}
                        updatedAt={row.updatedAt}
                        onOpen={() => open(row)}
                        actions={<BackupRowMenu name={row.name} groups={actionsOf(row)} />}
                    />
                )}
                renderRowMenu={(row, bulk) => (
                    <BackupContextMenu tile={<KindTile kind="retention" size="sm" />} title={row.name} note={describeConfig(row.config)} groups={actionsOf(row)} bulk={bulk} />
                )}
            />

            <RetentionDetails
                open={details?.open ?? false}
                row={shown}
                jobNames={jobNames}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onEdit={handlers.onEdit}
                onDefault={handlers.onDefault}
                groups={shown ? actionsOf(shown, true) : []}
            />

            <RetentionPolicyDialog
                open={form.open}
                onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                policy={form.policy}
                onSuccess={done(() => setForm({ open: false }))}
            />
            {defaulting && (
                <RetentionDefaultDialog
                    policy={defaulting}
                    current={rows?.find((row) => row.isDefault) ?? null}
                    onClose={() => setDefaulting(null)}
                    onDone={done(() => setDefaulting(null))}
                />
            )}
            {copying && (
                <TemplateDuplicateDialog
                    from={copying.name}
                    noun="policy"
                    existingNames={(rows ?? []).map((row) => row.name)}
                    facts={[{ icon: ListChecks, text: `The copy keeps ${keepsPhrase(copying.config)}. No destination uses it until one picks it.` }]}
                    create={(name) => createRetentionPolicy({ name, description: copying.description ?? undefined, config: copying.config })}
                    onClose={() => setCopying(null)}
                    onDone={done(() => setCopying(null))}
                />
            )}
            {removing && (
                <RetentionDeleteDialog
                    row={removing}
                    jobs={jobs}
                    onClose={() => setRemoving(null)}
                    onDeleted={done(() => {
                        setRemoving(null);
                        setDetails(null);
                    })}
                />
            )}
        </div>
    );
}
