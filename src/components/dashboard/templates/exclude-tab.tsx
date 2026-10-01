"use client";

import { useCallback, useImperativeHandle, useMemo, useState } from "react";
import { Filter, Trash } from "lucide-react";
import { toast } from "sonner";
import { createExcludePatternPreset, updateExcludePatternPreset } from "@/app/actions/templates";
import { bulkDeleteExcludePatternPresets } from "@/app/actions/templates-bulk";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { ExcludePatternPresetDialog } from "@/components/settings/templates/exclude-pattern-preset-dialog";
import type { BulkAction } from "@/components/ui/data-table";
import { useTableLayout } from "@/hooks/use-table-layout";
import { unwrapBulkAction } from "@/lib/bulk-request";
import { resolveExcludePatterns } from "@/lib/exclude-groups";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { ExcludeRow } from "@/services/templates/templates-types";
import { excludeColumns, excludeFilters, FolderStack, sourcesOf } from "./exclude-columns";
import { ExcludeDetails } from "./exclude-details";
import { templateActions, type TemplateActionHandlers } from "./template-actions";
import { TemplateCard } from "./template-card";
import { BuiltInBadge, DefaultBadge, KindTile } from "./template-cells";
import { ExcludeDeleteDialog } from "./template-delete-dialogs";
import { TemplateDuplicateDialog } from "./template-duplicate-dialog";
import { count, jobsById } from "./template-format";
import { ExcludeStrip } from "./template-strips";
import { TemplateTable } from "./template-table";
import type { TemplateTabProps } from "./template-tab-props";
import { TEMPLATE_TABLE_IDS } from "./template-tables";
import { useOpenFromLink } from "@/hooks/use-open-from-link";

const log = logger.child({ component: "ExcludeTab" });

const inUse = (row: ExcludeRow) => row.folders.length > 0;

/**
 * The exclude presets: the numbers, the list with what each skips and the folders using it, a panel
 * with its groups and patterns, and every dialog of a preset. A phone gets cards.
 */
export function ExcludeTab({ ref, model, isLoading, refresh, afterChange, cards, canManage, initialLayout }: TemplateTabProps) {
    const layout = useTableLayout(TEMPLATE_TABLE_IDS.excludes, initialLayout);
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [form, setForm] = useState<{ open: boolean; preset?: ExcludeRow }>({ open: false });
    const [copying, setCopying] = useState<ExcludeRow | null>(null);
    const [removing, setRemoving] = useState<ExcludeRow | null>(null);

    useImperativeHandle(ref, () => ({ openCreate: () => setForm({ open: true }) }), []);

    const rows = model?.excludes ?? null;
    const jobs = useMemo(() => jobsById(model?.jobs ?? []), [model]);

    // A default only fills in new folders and several can be one, so it changes at once, without a question.
    const setDefault = useCallback(async (row: ExcludeRow, on: boolean) => {
        try {
            const result = await updateExcludePatternPreset(row.id, { isDefault: on });
            if (!result.success) {
                toast.error(result.error || "The default could not be changed.");
                return;
            }
            toast.success(on ? `New folders start with ${row.name} now` : `New folders no longer start with ${row.name}`);
            afterChange();
        } catch (error: unknown) {
            log.warn("The default of an exclude preset could not be changed", { presetId: row.id }, wrapError(error));
            toast.error("The default could not be changed.");
        }
    }, [afterChange]);

    const handlers = useMemo<TemplateActionHandlers<ExcludeRow>>(() => canManage ? {
        onEdit: (row) => setForm({ open: true, preset: row }),
        onDefault: (row) => void setDefault(row, true),
        onUndefault: (row) => void setDefault(row, false),
        onDuplicate: setCopying,
        onDelete: setRemoving,
    } : {}, [canManage, setDefault]);

    const actionsOf = useCallback(
        (row: ExcludeRow, inPanel = false) => templateActions(row, handlers, { isDefault: row.isDefault, defaultLabel: "Default for new folders", inPanel }),
        [handlers]
    );
    const open = useCallback((row: ExcludeRow) => setDetails({ id: row.id, open: true }), []);
    // A link like the search in the header opens one with `?open=`.
    useOpenFromLink(rows, open);
    const columns = useMemo(() => excludeColumns({ onOpen: open, renderActions: (row) => <BackupRowMenu name={row.name} groups={actionsOf(row)} /> }), [open, actionsOf]);
    const filters = useMemo(() => excludeFilters(rows ?? [], jobs), [rows, jobs]);
    const bulkActions = useMemo<BulkAction<ExcludeRow>[]>(() => canManage ? [{
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "exclude preset" },
        icon: Trash,
        variant: "destructive",
        itemName: (row) => row.name,
        itemDetail: (row) => (row.folders.length > 0 ? `${count(row.folders.length, "folder")} lose its patterns` : count(resolveExcludePatterns(row).length, "pattern")),
        // Built-in presets ship with the product and the service refuses them.
        ineligible: (row) => (row.isSystem ? "Built in, stop it as default instead" : null),
        confirm: {
            title: (selected) => `Delete ${count(selected.length, "exclude preset")}?`,
            description: (selected) => (selected.some(inUse) ? "Their folders lose these patterns and back up what they skipped from their next run." : undefined),
            confirmLabel: "Delete",
        },
        run: (selected) => unwrapBulkAction(bulkDeleteExcludePatternPresets(selected.map((row) => row.id))),
    }] : [], [canManage]);

    const shown = details && rows ? rows.find((row) => row.id === details.id) ?? null : null;
    const done = (after: () => void) => () => {
        after();
        afterChange();
    };

    return (
        <div className="space-y-4 md:space-y-0">
            <ExcludeStrip model={model} />

            <TemplateTable
                rows={rows}
                isLoading={isLoading}
                onRefresh={refresh}
                columns={columns}
                filters={filters}
                searchPlaceholder="Search presets"
                inUse={inUse}
                loadingLabel="Loading exclude presets"
                cards={cards}
                selectable={canManage}
                bulkActions={bulkActions}
                onBulkActionComplete={afterChange}
                layout={layout}
                onOpen={open}
                renderCard={(row) => (
                    <TemplateCard
                        kind="exclude"
                        name={row.name}
                        sub={row.description || sourcesOf(row)}
                        badges={(row.isDefault || row.isSystem) && <>{row.isDefault && <DefaultBadge />}{row.isSystem && <BuiltInBadge />}</>}
                        what={<span>{count(resolveExcludePatterns(row).length, "pattern")} from {sourcesOf(row)}</span>}
                        usage={<FolderStack row={row} />}
                        updatedAt={row.updatedAt}
                        onOpen={() => open(row)}
                        actions={<BackupRowMenu name={row.name} groups={actionsOf(row)} />}
                    />
                )}
                renderRowMenu={(row, bulk) => (
                    <BackupContextMenu tile={<KindTile kind="exclude" size="sm" />} title={row.name} note={count(resolveExcludePatterns(row).length, "pattern")} groups={actionsOf(row)} bulk={bulk} />
                )}
            />

            <ExcludeDetails
                open={details?.open ?? false}
                row={shown}
                jobs={jobs}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onEdit={handlers.onEdit}
                onDefault={handlers.onDefault}
                groups={shown ? actionsOf(shown, true) : []}
            />

            <ExcludePatternPresetDialog
                open={form.open}
                onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                preset={form.preset}
                usedBy={form.preset?.folders.map((folder) => ({
                    key: folder.id,
                    path: folder.path,
                    detail: `folder of ${jobs.get(folder.jobId)?.name ?? "a job"}`,
                    adapterId: folder.adapterId,
                }))}
                onSuccess={done(() => setForm({ open: false }))}
            />
            {copying && (
                <TemplateDuplicateDialog
                    from={copying.name}
                    noun="preset"
                    existingNames={(rows ?? []).map((row) => row.name)}
                    facts={[{ icon: Filter, text: `The copy skips the same ${count(resolveExcludePatterns(copying).length, "pattern")}. No folder uses it until one picks it.` }]}
                    create={(name) =>
                        createExcludePatternPreset({
                            name,
                            description: copying.description ?? undefined,
                            patterns: copying.patterns,
                            groups: copying.groups,
                            excludedGroupPatterns: copying.excludedGroupPatterns,
                        })
                    }
                    onClose={() => setCopying(null)}
                    onDone={done(() => setCopying(null))}
                />
            )}
            {removing && (
                <ExcludeDeleteDialog
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
