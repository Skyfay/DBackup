"use client";

import { useCallback, useImperativeHandle, useMemo, useState } from "react";
import { CalendarClock, Trash } from "lucide-react";
import { createSchedulePreset } from "@/app/actions/templates";
import { bulkDeleteSchedulePresets } from "@/app/actions/templates-bulk";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { SchedulePresetDialog } from "@/components/settings/templates/schedule-preset-dialog";
import type { BulkAction } from "@/components/ui/data-table";
import { useTableLayout } from "@/hooks/use-table-layout";
import { unwrapBulkAction } from "@/lib/bulk-request";
import type { ScheduleRow } from "@/services/templates/templates-types";
import { followersOf, scheduleColumns, scheduleFilters, ScheduleWords } from "./schedule-columns";
import { ScheduleDetails } from "./schedule-details";
import { templateActions, type TemplateActionHandlers } from "./template-actions";
import { TemplateCard } from "./template-card";
import { JobsStack, KindTile } from "./template-cells";
import { ScheduleDeleteDialog } from "./template-delete-dialogs";
import { TemplateDuplicateDialog } from "./template-duplicate-dialog";
import { count, jobsById, lowerFirst } from "./template-format";
import { ScheduleStrip } from "./template-strips";
import { TemplateTable } from "./template-table";
import type { TemplateTabProps } from "./template-tab-props";
import { TEMPLATE_TABLE_IDS } from "./template-tables";
import { useOpenFromLink } from "@/hooks/use-open-from-link";

const inUse = (row: ScheduleRow) => row.jobIds.length > 0;

/**
 * The schedule presets: the numbers, the list with when each runs next, a panel with the next runs
 * and the jobs that follow a preset, and every dialog of a preset. A phone gets cards.
 */
export function ScheduleTab({ ref, model, isLoading, refresh, afterChange, cards, canManage, initialLayout }: TemplateTabProps) {
    const layout = useTableLayout(TEMPLATE_TABLE_IDS.schedules, initialLayout);
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [form, setForm] = useState<{ open: boolean; preset?: ScheduleRow }>({ open: false });
    const [copying, setCopying] = useState<ScheduleRow | null>(null);
    const [removing, setRemoving] = useState<ScheduleRow | null>(null);

    useImperativeHandle(ref, () => ({ openCreate: () => setForm({ open: true }) }), []);

    const rows = model?.schedules ?? null;
    const timezone = model?.timezone ?? "UTC";
    const jobs = useMemo(() => jobsById(model?.jobs ?? []), [model]);

    const handlers = useMemo<TemplateActionHandlers<ScheduleRow>>(() => canManage ? {
        onEdit: (row) => setForm({ open: true, preset: row }),
        onDuplicate: setCopying,
        onDelete: setRemoving,
    } : {}, [canManage]);

    // A preset has no default: a job picks its schedule itself.
    const actionsOf = useCallback((row: ScheduleRow, inPanel = false) => templateActions(row, handlers, { isDefault: false, inPanel }), [handlers]);
    const open = useCallback((row: ScheduleRow) => setDetails({ id: row.id, open: true }), []);
    // A link like the search in the header opens one with `?open=`.
    useOpenFromLink(rows, open);
    const columns = useMemo(
        () => scheduleColumns({ jobs, timezone, onOpen: open, renderActions: (row) => <BackupRowMenu name={row.name} groups={actionsOf(row)} /> }),
        [jobs, timezone, open, actionsOf]
    );
    const filters = useMemo(() => scheduleFilters(rows ?? [], jobs), [rows, jobs]);
    const bulkActions = useMemo<BulkAction<ScheduleRow>[]>(() => canManage ? [{
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "schedule preset" },
        icon: Trash,
        variant: "destructive",
        itemName: (row) => row.name,
        itemDetail: (row) => (row.jobIds.length > 0 ? `${count(row.jobIds.length, "job")} keep its time` : describeSchedule(row.schedule).text),
        confirm: {
            title: (selected) => `Delete ${count(selected.length, "schedule preset")}?`,
            description: (selected) =>
                selected.some(inUse) ? "The jobs that follow them keep running at the same time on their own. A later change of a preset no longer reaches them." : undefined,
            confirmLabel: "Delete",
        },
        run: (selected) => unwrapBulkAction(bulkDeleteSchedulePresets(selected.map((row) => row.id))),
    }] : [], [canManage]);

    const shown = details && rows ? rows.find((row) => row.id === details.id) ?? null : null;
    const done = (after: () => void) => () => {
        after();
        afterChange();
    };

    return (
        <div className="space-y-4 md:space-y-0">
            <ScheduleStrip model={model} />

            <TemplateTable
                rows={rows}
                isLoading={isLoading}
                onRefresh={refresh}
                columns={columns}
                filters={filters}
                searchPlaceholder="Search presets"
                inUse={inUse}
                loadingLabel="Loading schedule presets"
                cards={cards}
                selectable={canManage}
                bulkActions={bulkActions}
                onBulkActionComplete={afterChange}
                layout={layout}
                onOpen={open}
                renderCard={(row) => (
                    <TemplateCard
                        kind="schedule"
                        name={row.name}
                        sub={row.description || "Schedule"}
                        what={<ScheduleWords schedule={row.schedule} />}
                        usage={<JobsStack jobs={followersOf(row, jobs)} empty="no job follows it" />}
                        updatedAt={row.updatedAt}
                        onOpen={() => open(row)}
                        actions={<BackupRowMenu name={row.name} groups={actionsOf(row)} />}
                    />
                )}
                renderRowMenu={(row, bulk) => (
                    <BackupContextMenu tile={<KindTile kind="schedule" size="sm" />} title={row.name} note={describeSchedule(row.schedule).text} groups={actionsOf(row)} bulk={bulk} />
                )}
            />

            <ScheduleDetails
                open={details?.open ?? false}
                row={shown}
                jobs={jobs}
                timezone={timezone}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onEdit={handlers.onEdit}
                groups={shown ? actionsOf(shown, true) : []}
            />

            <SchedulePresetDialog
                open={form.open}
                onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                preset={form.preset}
                onSuccess={done(() => setForm({ open: false }))}
            />
            {copying && (
                <TemplateDuplicateDialog
                    from={copying.name}
                    noun="preset"
                    existingNames={(rows ?? []).map((row) => row.name)}
                    facts={[{ icon: CalendarClock, text: `The copy runs ${lowerFirst(describeSchedule(copying.schedule).text)}. No job follows it until one picks it.` }]}
                    create={(name) => createSchedulePreset({ name, description: copying.description ?? undefined, schedule: copying.schedule })}
                    onClose={() => setCopying(null)}
                    onDone={done(() => setCopying(null))}
                />
            )}
            {removing && (
                <ScheduleDeleteDialog
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
