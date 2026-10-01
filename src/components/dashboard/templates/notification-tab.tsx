"use client";

import { useCallback, useImperativeHandle, useMemo, useState } from "react";
import { Bell, Trash } from "lucide-react";
import { toast } from "sonner";
import { createNotificationTemplate, setDefaultNotificationTemplate, unsetDefaultNotificationTemplate } from "@/app/actions/templates";
import { bulkDeleteNotificationTemplates } from "@/app/actions/templates-bulk";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { NotificationTemplateDialog } from "@/components/settings/templates/notification-template-dialog";
import type { BulkAction } from "@/components/ui/data-table";
import { useTableLayout } from "@/hooks/use-table-layout";
import { unwrapBulkAction } from "@/lib/bulk-request";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { NotificationRow } from "@/services/templates/templates-types";
import { ChannelRuns, notificationColumns, notificationFilters, sendersOf } from "./notification-columns";
import { NotificationDetails } from "./notification-details";
import { templateActions, type TemplateActionHandlers } from "./template-actions";
import { TemplateCard } from "./template-card";
import { BuiltInBadge, DefaultBadge, JobsStack, KindTile } from "./template-cells";
import { NotificationDeleteDialog } from "./template-delete-dialogs";
import { TemplateDuplicateDialog } from "./template-duplicate-dialog";
import { count, jobsById } from "./template-format";
import { NotificationStrip } from "./template-strips";
import { TemplateTable } from "./template-table";
import type { TemplateTabProps } from "./template-tab-props";
import { TEMPLATE_TABLE_IDS } from "./template-tables";
import { useOpenFromLink } from "@/hooks/use-open-from-link";

const log = logger.child({ component: "NotificationTab" });

/** Why a template cannot be deleted yet, or null. The server refuses it the same way. */
function notificationBlocker(row: NotificationRow): string | null {
    if (row.isSystem) return "Built in";
    return row.jobIds.length > 0 ? `${count(row.jobIds.length, "job")} still ${row.jobIds.length === 1 ? "uses" : "use"} it` : null;
}

const inUse = (row: NotificationRow) => row.jobIds.length > 0;

/**
 * The notification templates: the numbers, the list with every channel and its runs, a panel with
 * who hears about which run, and every dialog of a template. A phone gets cards.
 */
export function NotificationTab({ ref, model, isLoading, refresh, afterChange, cards, canManage, initialLayout }: TemplateTabProps) {
    const layout = useTableLayout(TEMPLATE_TABLE_IDS.notifications, initialLayout);
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [form, setForm] = useState<{ open: boolean; template?: NotificationRow }>({ open: false });
    const [copying, setCopying] = useState<NotificationRow | null>(null);
    const [removing, setRemoving] = useState<NotificationRow | null>(null);

    useImperativeHandle(ref, () => ({ openCreate: () => setForm({ open: true }) }), []);

    const rows = model?.notifications ?? null;
    const jobs = useMemo(() => jobsById(model?.jobs ?? []), [model]);

    // A default only fills in new jobs, so it changes at once, without a question.
    const setDefault = useCallback(async (row: NotificationRow, on: boolean) => {
        try {
            const result = on ? await setDefaultNotificationTemplate(row.id) : await unsetDefaultNotificationTemplate();
            if (!result.success) {
                toast.error(result.error || "The default could not be changed.");
                return;
            }
            toast.success(on ? `New jobs start with ${row.name} now` : "New jobs start without a notification template now");
            afterChange();
        } catch (error: unknown) {
            log.warn("The default notification template could not be changed", { templateId: row.id }, wrapError(error));
            toast.error("The default could not be changed.");
        }
    }, [afterChange]);

    const handlers = useMemo<TemplateActionHandlers<NotificationRow>>(() => canManage ? {
        onEdit: (row) => setForm({ open: true, template: row }),
        onDefault: (row) => void setDefault(row, true),
        onUndefault: (row) => void setDefault(row, false),
        onDuplicate: setCopying,
        onDelete: setRemoving,
    } : {}, [canManage, setDefault]);

    const actionsOf = useCallback(
        (row: NotificationRow, inPanel = false) => templateActions(row, handlers, { isDefault: row.isDefault, editable: !row.isSystem, defaultLabel: "Default for new jobs", inPanel }),
        [handlers]
    );
    const open = useCallback((row: NotificationRow) => setDetails({ id: row.id, open: true }), []);
    // A link like the search in the header opens one with `?open=`.
    useOpenFromLink(rows, open);
    const columns = useMemo(
        () => notificationColumns({ jobs, onOpen: open, renderActions: (row) => <BackupRowMenu name={row.name} groups={actionsOf(row)} /> }),
        [jobs, open, actionsOf]
    );
    const filters = useMemo(() => notificationFilters(rows ?? [], jobs), [rows, jobs]);
    const bulkActions = useMemo<BulkAction<NotificationRow>[]>(() => canManage ? [{
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "notification template" },
        icon: Trash,
        variant: "destructive",
        itemName: (row) => row.name,
        itemDetail: (row) => count(row.channels.length, "channel"),
        // Built-in templates and the ones jobs send through are listed apart and never sent.
        ineligible: notificationBlocker,
        confirm: { title: (selected) => `Delete ${count(selected.length, "notification template")}?`, confirmLabel: "Delete" },
        run: (selected) => unwrapBulkAction(bulkDeleteNotificationTemplates(selected.map((row) => row.id))),
    }] : [], [canManage]);

    const shown = details && rows ? rows.find((row) => row.id === details.id) ?? null : null;
    const done = (after: () => void) => () => {
        after();
        afterChange();
    };

    return (
        <div className="space-y-4 md:space-y-0">
            <NotificationStrip model={model} />

            <TemplateTable
                rows={rows}
                isLoading={isLoading}
                onRefresh={refresh}
                columns={columns}
                filters={filters}
                searchPlaceholder="Search templates"
                inUse={inUse}
                loadingLabel="Loading notification templates"
                cards={cards}
                selectable={canManage}
                bulkActions={bulkActions}
                onBulkActionComplete={afterChange}
                layout={layout}
                onOpen={open}
                renderCard={(row) => (
                    <TemplateCard
                        kind="notification"
                        name={row.name}
                        sub={row.description || count(row.channels.length, "channel")}
                        badges={(row.isDefault || row.isSystem) && <>{row.isDefault && <DefaultBadge />}{row.isSystem && <BuiltInBadge />}</>}
                        what={<ChannelRuns row={row} />}
                        usage={<JobsStack jobs={sendersOf(row, jobs)} />}
                        updatedAt={row.updatedAt}
                        onOpen={() => open(row)}
                        actions={<BackupRowMenu name={row.name} groups={actionsOf(row)} />}
                    />
                )}
                renderRowMenu={(row, bulk) => (
                    <BackupContextMenu tile={<KindTile kind="notification" size="sm" />} title={row.name} note={count(row.channels.length, "channel")} groups={actionsOf(row)} bulk={bulk} />
                )}
            />

            <NotificationDetails
                open={details?.open ?? false}
                row={shown}
                jobs={jobs}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onEdit={handlers.onEdit}
                onDefault={handlers.onDefault}
                groups={shown ? actionsOf(shown, true) : []}
            />

            <NotificationTemplateDialog
                open={form.open}
                onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                template={form.template}
                channels={model?.channels ?? []}
                onSuccess={done(() => setForm({ open: false }))}
            />
            {copying && (
                <TemplateDuplicateDialog
                    from={copying.name}
                    noun="template"
                    existingNames={(rows ?? []).map((row) => row.name)}
                    facts={[{ icon: Bell, text: `The copy sends through ${count(copying.channels.length, "channel")} after the same runs. No job uses it until one picks it.` }]}
                    create={(name) =>
                        createNotificationTemplate({
                            name,
                            description: copying.description ?? undefined,
                            channels: copying.channels.map((channel) => ({ configId: channel.configId, events: channel.events })),
                        })
                    }
                    onClose={() => setCopying(null)}
                    onDone={done(() => setCopying(null))}
                />
            )}
            {removing && (
                <NotificationDeleteDialog
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
