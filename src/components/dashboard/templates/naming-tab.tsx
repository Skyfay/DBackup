"use client";

import { useCallback, useImperativeHandle, useMemo, useState } from "react";
import { FileText, Trash } from "lucide-react";
import { createNamingTemplate } from "@/app/actions/templates";
import { bulkDeleteNamingTemplates } from "@/app/actions/templates-bulk";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { NamingTemplateDialog } from "@/components/settings/templates/naming-template-dialog";
import type { BulkAction } from "@/components/ui/data-table";
import { useTableLayout } from "@/hooks/use-table-layout";
import { unwrapBulkAction } from "@/lib/bulk-request";
import type { NamingRow } from "@/services/templates/templates-types";
import { TokenPattern } from "./naming-cells";
import { jobsOf, namingColumns, namingFilters, NextFile } from "./naming-columns";
import { NamingDefaultDialog } from "./naming-default-dialog";
import { NamingDetails } from "./naming-details";
import { templateActions, type TemplateActionHandlers } from "./template-actions";
import { TemplateCard } from "./template-card";
import { BuiltInBadge, DefaultBadge, JobsStack, KindTile } from "./template-cells";
import { NamingDeleteDialog } from "./template-delete-dialogs";
import { TemplateDuplicateDialog } from "./template-duplicate-dialog";
import { count, jobsById } from "./template-format";
import { NamingStrip } from "./template-strips";
import { TemplateTable } from "./template-table";
import type { TemplateTabProps } from "./template-tab-props";
import { TEMPLATE_TABLE_IDS } from "./template-tables";
import { useOpenFromLink } from "@/hooks/use-open-from-link";

/** Why a template cannot be deleted yet, or null. The server refuses it the same way. */
function namingBlocker(row: NamingRow): string | null {
    if (row.isSystem) return "Built in";
    if (row.isDefault) return "The default, make another one the default first";
    const picked = row.uses.filter((use) => use.how === "picked").length;
    return picked > 0 ? `${count(picked, "job")} still ${picked === 1 ? "uses" : "use"} it` : null;
}

const inUse = (row: NamingRow) => row.uses.length > 0;

/**
 * The file name templates: the numbers, the list with the next file of each, a panel with the
 * pattern and the files of its jobs, and every dialog of a template. A phone gets cards.
 */
export function NamingTab({ ref, model, isLoading, refresh, afterChange, cards, canManage, initialLayout }: TemplateTabProps) {
    const layout = useTableLayout(TEMPLATE_TABLE_IDS.naming, initialLayout);
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [form, setForm] = useState<{ open: boolean; template?: NamingRow }>({ open: false });
    const [defaulting, setDefaulting] = useState<NamingRow | null>(null);
    const [copying, setCopying] = useState<NamingRow | null>(null);
    const [removing, setRemoving] = useState<NamingRow | null>(null);

    useImperativeHandle(ref, () => ({ openCreate: () => setForm({ open: true }) }), []);

    const rows = model?.naming ?? null;
    const timezone = model?.timezone ?? "UTC";
    const jobs = useMemo(() => jobsById(model?.jobs ?? []), [model]);

    const handlers = useMemo<TemplateActionHandlers<NamingRow>>(() => canManage ? {
        onEdit: (row) => setForm({ open: true, template: row }),
        onDefault: setDefaulting,
        onDuplicate: setCopying,
        onDelete: setRemoving,
    } : {}, [canManage]);

    // A built-in template cannot be changed, only made the default and copied.
    const actionsOf = useCallback(
        (row: NamingRow, inPanel = false) => templateActions(row, handlers, { isDefault: row.isDefault, editable: !row.isSystem, inPanel }),
        [handlers]
    );
    const open = useCallback((row: NamingRow) => setDetails({ id: row.id, open: true }), []);
    // A link like the search in the header opens one with `?open=`.
    useOpenFromLink(rows, open);
    const columns = useMemo(
        () => namingColumns({ jobs, timezone, onOpen: open, renderActions: (row) => <BackupRowMenu name={row.name} groups={actionsOf(row)} /> }),
        [jobs, timezone, open, actionsOf]
    );
    const filters = useMemo(() => namingFilters(rows ?? [], jobs), [rows, jobs]);
    const bulkActions = useMemo<BulkAction<NamingRow>[]>(() => canManage ? [{
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "file name template" },
        icon: Trash,
        variant: "destructive",
        itemName: (row) => row.name,
        itemDetail: (row) => row.pattern,
        // Built-in and default templates, and the ones jobs picked, are listed apart and never sent.
        ineligible: namingBlocker,
        confirm: { title: (selected) => `Delete ${count(selected.length, "file name template")}?`, confirmLabel: "Delete" },
        run: (selected) => unwrapBulkAction(bulkDeleteNamingTemplates(selected.map((row) => row.id))),
    }] : [], [canManage]);

    const shown = details && rows ? rows.find((row) => row.id === details.id) ?? null : null;
    const done = (after: () => void) => () => {
        after();
        afterChange();
    };

    return (
        <div className="space-y-4 md:space-y-0">
            <NamingStrip model={model} />

            <TemplateTable
                rows={rows}
                isLoading={isLoading}
                onRefresh={refresh}
                columns={columns}
                filters={filters}
                searchPlaceholder="Search templates"
                inUse={inUse}
                loadingLabel="Loading file name templates"
                cards={cards}
                selectable={canManage}
                bulkActions={bulkActions}
                onBulkActionComplete={afterChange}
                layout={layout}
                onOpen={open}
                renderCard={(row) => (
                    <TemplateCard
                        kind="naming"
                        name={row.name}
                        sub={row.description || "File names"}
                        badges={(row.isDefault || row.isSystem) && <>{row.isDefault && <DefaultBadge />}{row.isSystem && <BuiltInBadge />}</>}
                        what={<div className="space-y-2"><TokenPattern pattern={row.pattern} /><NextFile row={row} jobs={jobs} timezone={timezone} /></div>}
                        usage={<JobsStack jobs={jobsOf(row, jobs)} />}
                        updatedAt={row.updatedAt}
                        onOpen={() => open(row)}
                        actions={<BackupRowMenu name={row.name} groups={actionsOf(row)} />}
                    />
                )}
                renderRowMenu={(row, bulk) => (
                    <BackupContextMenu tile={<KindTile kind="naming" size="sm" />} title={row.name} note={row.pattern} groups={actionsOf(row)} bulk={bulk} />
                )}
            />

            <NamingDetails
                open={details?.open ?? false}
                row={shown}
                jobs={jobs}
                timezone={timezone}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onEdit={handlers.onEdit}
                onDefault={handlers.onDefault}
                groups={shown ? actionsOf(shown, true) : []}
            />

            <NamingTemplateDialog
                open={form.open}
                onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                template={form.template}
                onSuccess={done(() => setForm({ open: false }))}
            />
            {defaulting && (
                <NamingDefaultDialog
                    template={defaulting}
                    current={rows?.find((row) => row.isDefault) ?? null}
                    jobs={jobs}
                    timezone={timezone}
                    onClose={() => setDefaulting(null)}
                    onDone={done(() => setDefaulting(null))}
                />
            )}
            {copying && (
                <TemplateDuplicateDialog
                    from={copying.name}
                    noun="template"
                    existingNames={(rows ?? []).map((row) => row.name)}
                    facts={[{ icon: FileText, text: `The copy names files ${copying.pattern}. No job uses it until one picks it.` }]}
                    create={(name) => createNamingTemplate({ name, description: copying.description ?? undefined, pattern: copying.pattern })}
                    onClose={() => setCopying(null)}
                    onDone={done(() => setCopying(null))}
                />
            )}
            {removing && (
                <NamingDeleteDialog
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
