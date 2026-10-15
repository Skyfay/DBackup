"use client";

import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Globe, Info, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deletePlatformGroup } from "@/app/actions/auth/platform-group";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { JOIN_END } from "@/components/ui/page-head";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageModel } from "@/hooks/use-page-model";
import { PLATFORM_AREAS } from "@/lib/auth/permission-areas";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { PlatformGroupRow, PlatformGroupsModel } from "@/services/user/platform-groups-types";
import { PlatformGroupTile } from "./platform-group-cells";
import { platformGroupActions, platformGroupColumns, platformRights, type PlatformGroupHandlers } from "./platform-group-columns";
import { PlatformGroupDialog } from "./platform-group-dialog";
import { editableBy, type PlatformGroupFormMode } from "./platform-group-form";
import { PlatformGroupStrip } from "./platform-group-strip";

const log = logger.child({ component: "platform-group-list" });

/** What the page around the list can start, New platform group beside the tabs. */
export interface PlatformGroupListHandle {
    openCreate: () => void;
}

interface PlatformGroupListProps {
    ref?: Ref<PlatformGroupListHandle>;
    cards: boolean;
    /** May make, change, give and delete platform groups. */
    canManage: boolean;
    /** The switch to the groups of the tenants, before the search. */
    toolbarStart: React.ReactNode;
}

/**
 * The platform groups of Users & Groups under Platform: Platform admin, built in and locked, then
 * the groups of the people of the MSP, each with its rights on the platform, its rights in the
 * tenants with the levels of the areas, where they count, its members and when it changed. A click
 * opens the editor, read only for Platform admin and for a group the viewer may not change.
 */
export function PlatformGroupList({ ref, cards, canManage, toolbarStart }: PlatformGroupListProps) {
    const router = useRouter();
    const { model, isLoading, refresh } = usePageModel<PlatformGroupsModel>("/api/platform/platform-groups", "The platform groups could not be loaded.");
    const [form, setForm] = useState<{ open: boolean; mode: PlatformGroupFormMode }>({ open: false, mode: { kind: "create" } });
    const [removing, setRemoving] = useState<PlatformGroupRow | null>(null);
    const [pending, setPending] = useState(false);

    useImperativeHandle(ref, () => ({ openCreate: () => setForm({ open: true, mode: { kind: "create" } }) }), []);

    const afterChange = useCallback(() => {
        void refresh();
        router.refresh();
    }, [refresh, router]);

    const handlers = useMemo<PlatformGroupHandlers>(() => ({
        onOpen: (group) => setForm({ open: true, mode: { kind: "edit", group } }),
        ...(canManage ? {
            onEdit: (group: PlatformGroupRow) => setForm({ open: true, mode: { kind: "edit", group } }),
            onDuplicate: (group: PlatformGroupRow) => setForm({ open: true, mode: { kind: "duplicate", group } }),
            onDelete: setRemoving,
        } : {}),
    }), [canManage]);

    const editable = useCallback((group: PlatformGroupRow) => (model ? canManage && editableBy(group, model.viewer) : false), [model, canManage]);
    const actionsOf = useCallback((group: PlatformGroupRow) => platformGroupActions(group, handlers, editable(group)), [handlers, editable]);

    const columns = useMemo(() => platformGroupColumns({
        tenants: model?.tenants ?? [],
        onOpen: handlers.onOpen,
        renderActions: (group) => <BackupRowMenu name={group.name} groups={actionsOf(group)} />,
    }), [model, handlers, actionsOf]);

    const remove = async (group: PlatformGroupRow) => {
        setPending(true);
        try {
            const result = await deletePlatformGroup(group.id);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(`${group.name} deleted`);
            setRemoving(null);
            afterChange();
        } catch (error: unknown) {
            log.warn("Deleting a platform group failed", { groupId: group.id }, wrapError(error));
            toast.error("The platform group could not be deleted.");
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="space-y-4 md:space-y-0">
            <PlatformGroupStrip model={model} />
            {!model ? (
                <div className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-sm", JOIN_END)} aria-busy="true">
                    <span className="sr-only">Loading the platform groups</span>
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-60" />
                        <Skeleton className="h-8 w-24" />
                    </div>
                    {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
                </div>
            ) : (
                <DataTable
                    joined
                    columns={columns}
                    data={model.groups}
                    searchKey="name"
                    searchPlaceholder="Search platform groups"
                    toolbarStart={toolbarStart}
                    filterableColumns={[
                        { id: "where", title: "Where", options: [{ label: "All tenants", value: "all", icon: Globe }, { label: "Selected tenants", value: "selected" }] },
                        { id: "platform", title: "Platform right", options: PLATFORM_AREAS.map((area) => ({ label: area.label, value: area.id })) },
                    ]}
                    onRefresh={refresh}
                    isLoading={isLoading}
                    getRowId={(group) => group.id}
                    onRowClick={handlers.onOpen}
                    activeRowId={form.open && form.mode.kind === "edit" ? form.mode.group.id : null}
                    view={cards ? "cards" : "table"}
                    renderCard={(row) => (
                        <button
                            type="button"
                            onClick={() => handlers.onOpen(row.original)}
                            className="flex w-full min-w-0 items-start gap-3 rounded-xl border bg-card p-4 text-left text-card-foreground shadow-sm outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <PlatformGroupTile group={row.original} size="lg" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold">{row.original.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">{platformRights(row.original).line}</span>
                            </span>
                        </button>
                    )}
                    renderRowMenu={(group, bulk) => (
                        <BackupContextMenu tile={<PlatformGroupTile group={group} size="sm" />} title={group.name} note={platformRights(group).line} groups={actionsOf(group)} bulk={bulk} />
                    )}
                />
            )}
            <p className="flex items-center gap-2 text-xs text-muted-foreground md:mt-4">
                <Info className="size-3.5 shrink-0" aria-hidden="true" />
                A person holds one platform group. In a tenant it adds to their group there, while the tenant is in its scope.
            </p>

            {model && (
                <PlatformGroupDialog
                    open={form.open}
                    mode={form.mode}
                    model={model}
                    canManage={canManage}
                    onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                    onDuplicate={(group) => setForm({ open: true, mode: { kind: "duplicate", group } })}
                    onSaved={afterChange}
                />
            )}
            {removing && (
                <ConfirmDialog
                    open
                    onOpenChange={(next) => !next && !pending && setRemoving(null)}
                    title={`Delete ${removing.name}?`}
                    note="Its members keep their accounts"
                    icon={Trash2}
                    description={removing.members.length > 0
                        ? `${removing.members.length === 1 ? "Its member keeps" : `Its ${removing.members.length} members keep`} their accounts and their groups in the tenants, and hold no platform group any more.`
                        : "Nobody holds it. It goes at once."}
                    confirmLabel={`Delete ${removing.name}`}
                    destructive
                    isPending={pending}
                    onConfirm={() => void remove(removing)}
                />
            )}
        </div>
    );
}
