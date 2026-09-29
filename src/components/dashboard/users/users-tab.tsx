"use client";

import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Trash } from "lucide-react";
import { bulkDeleteUsers } from "@/app/actions/auth/user";
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
import type { UserRow, UsersModel } from "@/services/user/users-types";
import { userActions, type UserActionHandlers } from "./user-actions";
import { UserCard } from "./user-card";
import { UserAvatar } from "./user-cells";
import { userColumns, userFilters } from "./user-columns";
import { UserConfirmDialog, type UserConfirmKind } from "./user-confirm-dialogs";
import { UserDetails } from "./user-details";
import { UserDialog } from "./user-dialog";
import { UserPasswordDialog } from "./user-password-dialog";
import { UsersStrip } from "./user-strip";
import { USERS_TABLE_ID } from "./users-tables";

/** What the page around the list can start, like New user beside the tabs. */
export interface UsersTabHandle {
    openCreate: () => void;
}

type Quick = "all" | "no-factor" | "no-group";

const QUICK: { value: Quick; label: string; keep: (user: UserRow) => boolean }[] = [
    { value: "all", label: "All", keep: () => true },
    { value: "no-factor", label: "No second factor", keep: (user) => user.secondFactor === "none" },
    { value: "no-group", label: "No group", keep: (user) => !user.group },
];

interface UsersTabProps {
    ref?: Ref<UsersTabHandle>;
    cards: boolean;
    /** May create, change and delete users. */
    canManage: boolean;
    initialLayout: TablePreferences | null;
}

/**
 * The users: the numbers, then the list with its filters, a panel with the details of a user, and
 * every dialog of a user. A phone gets cards.
 */
export function UsersTab({ ref, cards, canManage, initialLayout }: UsersTabProps) {
    const router = useRouter();
    const { model, isLoading, refresh } = usePageModel<UsersModel>("/api/users", "The users could not be loaded.");
    const layout = useTableLayout(USERS_TABLE_ID, initialLayout);
    const [quick, setQuick] = useState<Quick>("all");
    // The id stays after closing, so the panel keeps its content while it slides out.
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [version, setVersion] = useState(0);
    const [form, setForm] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
    const [password, setPassword] = useState<UserRow | null>(null);
    const [confirm, setConfirm] = useState<{ kind: UserConfirmKind; user: UserRow } | null>(null);

    useImperativeHandle(ref, () => ({ openCreate: () => setForm({ open: true, user: null }) }), []);

    // The counts beside the tabs come from the server, so they are loaded again too.
    const afterChange = useCallback(() => {
        void refresh();
        setVersion((current) => current + 1);
        router.refresh();
    }, [refresh, router]);

    const viewerSuperAdmin = model?.viewerSuperAdmin ?? false;
    // Only a SuperAdmin sets the password of a SuperAdmin, resets their second factor, signs them out or deletes one.
    const guarded = useCallback((user: UserRow) => user.superAdmin && !viewerSuperAdmin, [viewerSuperAdmin]);

    const handlers = useMemo<UserActionHandlers>(() => canManage ? {
        onEdit: (user) => setForm({ open: true, user }),
        onPassword: setPassword,
        onResetTwoFactor: (user) => setConfirm({ kind: "reset-2fa", user }),
        onSignOut: (user) => setConfirm({ kind: "sign-out", user }),
        onDelete: (user) => setConfirm({ kind: "delete", user }),
    } : {}, [canManage]);

    /** The handlers for one user, without what the viewer may not do to them. */
    const handlersFor = useCallback((user: UserRow): UserActionHandlers => guarded(user)
        ? { ...handlers, onPassword: undefined, onResetTwoFactor: undefined, onSignOut: undefined, onDelete: undefined }
        : handlers, [handlers, guarded]);

    const open = useCallback((user: UserRow) => setDetails({ id: user.id, open: true }), []);
    const columns = useMemo(
        () => userColumns({ onOpen: open, renderActions: (user) => <BackupRowMenu name={user.name} groups={userActions(user, handlersFor(user))} /> }),
        [open, handlersFor]
    );

    const users = useMemo(() => model?.users ?? [], [model]);
    const rows = useMemo(() => users.filter(QUICK.find((option) => option.value === quick)?.keep ?? (() => true)), [users, quick]);
    const filters = useMemo(() => userFilters(users), [users]);
    const bulkActions = useMemo<BulkAction<UserRow>[]>(() => canManage ? [{
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "user" },
        icon: Trash,
        variant: "destructive",
        itemName: (user) => user.name,
        itemDetail: (user) => user.email,
        ineligible: (user) => (guarded(user) ? "Only a SuperAdmin can delete a SuperAdmin" : null),
        confirm: {
            title: (selected) => `Delete ${selected.length} user${selected.length === 1 ? "" : "s"}?`,
            description: () => "Their sessions end at once and their API keys stop working. The last SuperAdmin and the last account are kept.",
            confirmLabel: "Delete",
        },
        run: (selected) => unwrapBulkAction(bulkDeleteUsers(selected.map((user) => user.id))),
    }] : [], [canManage, guarded]);

    const shown = details ? users.find((user) => user.id === details.id) ?? null : null;
    const shownHandlers = shown ? handlersFor(shown) : {};

    return (
        <div className="space-y-4 md:space-y-0">
            <UsersStrip model={model} />

            {!model ? (
                <div className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-sm", JOIN_END)} aria-busy="true">
                    <span className="sr-only">Loading users</span>
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-60" />
                        <Skeleton className="h-8 w-24" />
                    </div>
                    {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
                </div>
            ) : (
                <DataTable
                    variant="card"
                    joined
                    columns={columns}
                    data={rows}
                    searchKey="name"
                    searchPlaceholder="Search users"
                    filterableColumns={filters}
                    toolbarExtra={
                        <QuickFilter
                            aria-label="Filter by what needs a look"
                            value={quick}
                            onChange={setQuick}
                            options={QUICK.map((option) => ({
                                value: option.value,
                                label: option.label,
                                count: users.filter(option.keep).length,
                                ...(option.value === "no-group" && users.some((user) => !user.group) ? { dot: "bg-warning" } : {}),
                            }))}
                        />
                    }
                    onRefresh={refresh}
                    isLoading={isLoading}
                    enableRowSelection={canManage && !cards}
                    getRowId={(user) => user.id}
                    isRowSelectable={(user) => !user.isYou}
                    bulkActions={bulkActions}
                    onBulkActionComplete={afterChange}
                    columnLayout={layout}
                    onRowClick={open}
                    activeRowId={details?.open ? details.id : null}
                    view={cards ? "cards" : "table"}
                    renderCard={(row) => (
                        <UserCard user={row.original} onOpen={open} actions={<BackupRowMenu name={row.original.name} groups={userActions(row.original, handlersFor(row.original))} />} />
                    )}
                    renderRowMenu={(user, bulk) => (
                        <BackupContextMenu
                            tile={<UserAvatar user={user} size="sm" />}
                            title={user.name}
                            note={user.email}
                            groups={userActions(user, handlersFor(user))}
                            bulk={bulk}
                        />
                    )}
                />
            )}

            <UserDetails
                open={details?.open ?? false}
                user={shown}
                groups={model?.groups ?? []}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onEdit={shownHandlers.onEdit}
                onPassword={shownHandlers.onPassword}
                onResetTwoFactor={shownHandlers.onResetTwoFactor}
                onSignOut={shownHandlers.onSignOut}
                groupsMenu={shown ? userActions(shown, shownHandlers, true) : []}
                onChanged={afterChange}
                version={version}
            />

            <UserDialog
                open={form.open}
                user={form.user}
                groups={model?.groups ?? []}
                viewerSuperAdmin={viewerSuperAdmin}
                onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                onSaved={afterChange}
            />

            {password && (
                <UserPasswordDialog
                    user={password}
                    onClose={() => setPassword(null)}
                    onDone={() => {
                        setPassword(null);
                        afterChange();
                    }}
                />
            )}
            {confirm && (
                <UserConfirmDialog
                    kind={confirm.kind}
                    user={confirm.user}
                    onClose={() => setConfirm(null)}
                    onDone={() => {
                        if (confirm.kind === "delete") setDetails(null);
                        setConfirm(null);
                        afterChange();
                    }}
                />
            )}
        </div>
    );
}
