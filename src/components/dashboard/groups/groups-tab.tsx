"use client";

import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Trash } from "lucide-react";
import { bulkDeleteGroups } from "@/app/actions/auth/group";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { JOIN_END } from "@/components/ui/page-head";
import { QuickFilter } from "@/components/ui/quick-filter";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageModel } from "@/hooks/use-page-model";
import { useTableLayout } from "@/hooks/use-table-layout";
import { unwrapBulkAction } from "@/lib/bulk-request";
import type { TablePreferences } from "@/lib/core/table-preferences";
import { cn } from "@/lib/utils";
import type { GroupMember, GroupRow, GroupsModel } from "@/services/user/groups-types";
import { groupActions, type GroupActionHandlers } from "./group-actions";
import { GroupCard } from "./group-card";
import { countWord, GroupTile } from "./group-cells";
import { groupColumns, groupLine } from "./group-columns";
import { GroupDeleteDialog } from "./group-delete-dialog";
import { GroupDetails } from "./group-details";
import { GroupFormDialog, type GroupFormMode } from "./group-form-dialog";
import { GroupMoveDialog, type GroupMoveTask } from "./group-move-dialog";
import { GroupsStrip } from "./group-strip";
import { GROUPS_TABLE_ID } from "./groups-tables";
import { useOpenFromLink } from "@/hooks/use-open-from-link";

/** What the page around the list can start, like New group beside the tabs. */
export interface GroupsTabHandle {
    openCreate: () => void;
}

type Quick = "all" | "members" | "empty";

const QUICK: { value: Quick; label: string; keep: (group: GroupRow) => boolean }[] = [
    { value: "all", label: "All", keep: () => true },
    { value: "members", label: "With members", keep: (group) => group.members.length > 0 },
    { value: "empty", label: "Empty", keep: (group) => group.members.length === 0 },
];

interface GroupsTabProps {
    ref?: Ref<GroupsTabHandle>;
    view: "table" | "cards";
    /** May create, change and delete groups. */
    canManage: boolean;
    /** May move people between groups, which changes the users. */
    canMove: boolean;
    initialLayout: TablePreferences | null;
}

/**
 * The groups: the numbers, then the list as a table or as cards, a panel with the details of a
 * group, and the dialogs to make, change, delete a group and move its people. A phone gets cards.
 */
export function GroupsTab({ ref, view, canManage, canMove, initialLayout }: GroupsTabProps) {
    const router = useRouter();
    const { model, isLoading, refresh } = usePageModel<GroupsModel>("/api/groups", "The groups could not be loaded.");
    const layout = useTableLayout(GROUPS_TABLE_ID, initialLayout);
    const [quick, setQuick] = useState<Quick>("all");
    // The id stays after closing, so the panel keeps its content while it slides out.
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [version, setVersion] = useState(0);
    const [form, setForm] = useState<{ open: boolean; mode: GroupFormMode }>({ open: false, mode: { kind: "create" } });
    const [removing, setRemoving] = useState<GroupRow | null>(null);
    const [moving, setMoving] = useState<GroupMoveTask | null>(null);

    useImperativeHandle(ref, () => ({ openCreate: () => setForm({ open: true, mode: { kind: "create" } }) }), []);

    // The counts beside the tabs come from the server, so they are loaded again too.
    const afterChange = useCallback(() => {
        void refresh();
        setVersion((current) => current + 1);
        router.refresh();
    }, [refresh, router]);

    const viewerSuperAdmin = model?.viewerSuperAdmin ?? false;
    const handlers = useMemo<GroupActionHandlers>(() => canManage ? {
        onEdit: (group) => setForm({ open: true, mode: { kind: "edit", group } }),
        onDuplicate: (group) => setForm({ open: true, mode: { kind: "duplicate", group } }),
        onDelete: setRemoving,
    } : {}, [canManage]);

    // Only a SuperAdmin moves people into or out of the SuperAdmin group.
    const movable = useCallback((group: GroupRow) => canMove && (!group.superAdmin || viewerSuperAdmin), [canMove, viewerSuperAdmin]);

    const open = useCallback((group: GroupRow) => setDetails({ id: group.id, open: true }), []);
    // A link like the search in the header opens one with `?open=`.
    useOpenFromLink(model?.groups, open);
    const columns = useMemo(
        () => groupColumns({ onOpen: open, renderActions: (group) => <BackupRowMenu name={group.name} groups={groupActions(group, handlers)} /> }),
        [open, handlers]
    );

    const groups = useMemo(() => model?.groups ?? [], [model]);
    const rows = useMemo(() => groups.filter(QUICK.find((option) => option.value === quick)?.keep ?? (() => true)), [groups, quick]);
    const bulkActions = useMemo<BulkAction<GroupRow>[]>(() => canManage ? [{
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "group" },
        icon: Trash,
        variant: "destructive",
        itemName: (group) => group.name,
        itemDetail: (group) => countWord(group.members.length, "member", "members"),
        // A group with members is deleted on its own, where the dialog asks where they go.
        ineligible: (group) => (group.superAdmin ? "Built in" : group.members.length > 0 ? "People are in it, delete it on its own to move them" : null),
        confirm: {
            title: (selected) => `Delete ${selected.length} group${selected.length === 1 ? "" : "s"}?`,
            description: () => "Nobody is in these groups, so no one loses access.",
            confirmLabel: "Delete",
        },
        run: (selected) => unwrapBulkAction(bulkDeleteGroups(selected.map((group) => group.id))),
    }] : [], [canManage]);

    const shown = details ? groups.find((group) => group.id === details.id) ?? null : null;

    return (
        <div className="space-y-4 md:space-y-0">
            <GroupsStrip model={model} />

            {!model ? (
                <div className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-sm", JOIN_END)} aria-busy="true">
                    <span className="sr-only">Loading groups</span>
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-60" />
                        <Skeleton className="h-8 w-24" />
                    </div>
                    {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
                </div>
            ) : (
                <DataTable
                    variant="card"
                    joined
                    columns={columns}
                    data={rows}
                    searchKey="name"
                    searchPlaceholder="Search groups"
                    toolbarExtra={
                        <QuickFilter
                            aria-label="Filter by members"
                            value={quick}
                            onChange={setQuick}
                            options={QUICK.map((option) => ({ value: option.value, label: option.label, count: groups.filter(option.keep).length }))}
                        />
                    }
                    onRefresh={refresh}
                    isLoading={isLoading}
                    enableRowSelection={canManage && view === "table"}
                    getRowId={(group) => group.id}
                    isRowSelectable={(group) => !group.superAdmin}
                    bulkActions={bulkActions}
                    onBulkActionComplete={afterChange}
                    columnLayout={layout}
                    onRowClick={open}
                    activeRowId={details?.open ? details.id : null}
                    view={view}
                    renderCard={(row) => (
                        <GroupCard group={row.original} onOpen={open} actions={<BackupRowMenu name={row.original.name} groups={groupActions(row.original, handlers)} />} />
                    )}
                    renderRowMenu={(group, bulk) => (
                        <BackupContextMenu tile={<GroupTile group={group} size="sm" />} title={group.name} note={groupLine(group)} groups={groupActions(group, handlers)} bulk={bulk} />
                    )}
                />
            )}

            <GroupDetails
                open={details?.open ?? false}
                group={shown}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onEdit={handlers.onEdit}
                onDuplicate={handlers.onDuplicate}
                onMove={shown && movable(shown) ? (group: GroupRow, member: GroupMember) => setMoving({ kind: "member", group, member }) : undefined}
                onAddPeople={shown && movable(shown) && model?.people ? (group: GroupRow) => setMoving({ kind: "add", group }) : undefined}
                groupsMenu={shown ? groupActions(shown, handlers, true) : []}
                version={version}
            />

            <GroupFormDialog
                open={form.open}
                mode={form.mode}
                groups={groups}
                onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                onSaved={afterChange}
            />

            {removing && (
                <GroupDeleteDialog
                    group={removing}
                    groups={groups}
                    viewerSuperAdmin={viewerSuperAdmin}
                    onClose={() => setRemoving(null)}
                    onDeleted={() => {
                        setRemoving(null);
                        setDetails(null);
                        afterChange();
                    }}
                />
            )}
            {moving && (
                <GroupMoveDialog
                    task={moving}
                    groups={groups}
                    people={model?.people ?? []}
                    viewerSuperAdmin={viewerSuperAdmin}
                    onClose={() => setMoving(null)}
                    onDone={() => {
                        setMoving(null);
                        afterChange();
                    }}
                />
            )}
        </div>
    );
}
