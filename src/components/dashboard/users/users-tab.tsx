"use client";

import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Trash } from "lucide-react";
import { bulkDeleteUsers } from "@/app/actions/auth/user";
import { usePlatformAdminRole } from "@/components/dashboard/platform/platform-admin-role";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { useViewerPermissions } from "@/components/permissions/permissions-context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { useTenantName, useTenantView } from "@/components/tenant/tenant-view";
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
import { InvitationsBanner, useOpenInvitations } from "./invitations-banner";
import { InviteDialog } from "./invite-dialog";
import { PlatformPeoplePart } from "./platform-people";
import { accountLock, groupLock } from "./user-access";
import { userActions, type UserActionHandlers } from "./user-actions";
import { UserCard } from "./user-card";
import { UserAvatar } from "./user-cells";
import { userColumns, userFilters } from "./user-columns";
import { UserConfirmDialog, type UserConfirmKind } from "./user-confirm-dialogs";
import { useTrash } from "@/components/trash/use-trash";
import { UserDetails } from "./user-details";
import { UserDialog } from "./user-dialog";
import { UserPasswordDialog } from "./user-password-dialog";
import { UsersStrip } from "./user-strip";
import { onPlatform } from "./user-tenants";
import { USERS_TABLE_ID } from "./users-tables";
import { useNewFromLink } from "@/hooks/use-new-from-link";
import { useOpenFromLink } from "@/hooks/use-open-from-link";

/** What the page around the list can start, like New user and Invite beside the tabs. */
export interface UsersTabHandle {
    openCreate: () => void;
    openInvite: () => void;
}

type Quick = "all" | "no-factor" | "no-group";

/** Sees nothing: no group in the tenant, or in All tenants no tenant at all, and nothing on the platform. */
const placeless = (user: UserRow) => (user.tenants ? user.tenants.length === 0 : !user.group) && !onPlatform(user);

const QUICK: { value: Quick; label: string; keep: (user: UserRow) => boolean }[] = [
    { value: "all", label: "All", keep: () => true },
    { value: "no-factor", label: "No second factor", keep: (user) => user.secondFactor === "none" },
    { value: "no-group", label: "No group", keep: placeless },
];

interface UsersTabProps {
    ref?: Ref<UsersTabHandle>;
    cards: boolean;
    /** May create, change and delete users. */
    canManage: boolean;
    initialLayout: TablePreferences | null;
    /** Where the list loads from: the members of the open tenant, or every account for the Platform. */
    source?: string;
    /** Shows the open invitations of the tenant and offers Invite, which the list of every account leaves out. */
    withInvitations?: boolean;
    /** Offers Make platform admin and its way back on every account but the own, which the list of every account of the Platform does for a platform admin. */
    platformRole?: boolean;
}

/**
 * The users of the open tenant: the numbers, then the list with its filters, the open invitations,
 * a panel with the details of a user, and every dialog of a user. A phone gets cards. Users &
 * Groups of the Platform lists every account of the instance once, with its tenants in place of
 * its group.
 */
export function UsersTab({ ref, cards, canManage, initialLayout, source = "/api/users", withInvitations = true, platformRole = false }: UsersTabProps) {
    const router = useRouter();
    const { model, isLoading, refresh } = usePageModel<UsersModel>(source, "The users could not be loaded.");
    const layout = useTableLayout(USERS_TABLE_ID, initialLayout);
    const [quick, setQuick] = useState<Quick>("all");
    // The id stays after closing, so the panel keeps its content while it slides out.
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [version, setVersion] = useState(0);
    const [form, setForm] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
    const [password, setPassword] = useState<UserRow | null>(null);
    const [confirm, setConfirm] = useState<{ kind: UserConfirmKind; user: UserRow } | null>(null);
    const [inviting, setInviting] = useState(false);
    const { invitations, reload: reloadInvitations } = useOpenInvitations(withInvitations);

    useImperativeHandle(ref, () => ({
        openCreate: () => setForm({ open: true, user: null }),
        openInvite: () => setInviting(true),
    }), []);

    // The counts beside the tabs come from the server, so they are loaded again too.
    const afterChange = useCallback(() => {
        void refresh();
        setVersion((current) => current + 1);
        router.refresh();
    }, [refresh, router]);

    const viewerPlatformAdmin = model?.viewerPlatformAdmin ?? false;
    const allTenants = model?.allTenants ?? false;
    const tenantName = useTenantName();
    const { activeTenantId } = useTenantView();
    // In All tenants the Group column and filter turn into the tenants of each account.
    const tenantNameOf = allTenants ? tenantName : undefined;
    // Invite of All tenants picks the tenant first and lands here with `?new=1`, a new user needs no tenant picked first.
    useNewFromLink(model !== null && canManage && !allTenants && withInvitations, () => setInviting(true));
    // Only a platform admin changes the account of a platform admin, or, besides whoever manages the
    // accounts of the platform, one that also works in another tenant: its password, second factor,
    // sessions, name, email, or the account itself.
    const permissions = useViewerPermissions();
    // Outside the dashboard, like in a test, the platform admin flag of the list decides as before.
    const managesAccounts = permissions?.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE) ?? false;
    const managesTenants = permissions?.includes(PERMISSIONS.PLATFORM.TENANTS_WRITE) ?? viewerPlatformAdmin;
    const lockOf = useCallback((user: UserRow) => accountLock(user, viewerPlatformAdmin, managesAccounts), [viewerPlatformAdmin, managesAccounts]);
    const groups = useMemo(() => model?.groups ?? [], [model]);
    // Edit has nothing left to change when the account and the group are both closed to the viewer.
    const closed = useCallback(
        (user: UserRow) => lockOf(user) !== null && groupLock(user, groups, { platformAdmin: viewerPlatformAdmin, permissions }) !== null,
        [lockOf, groups, viewerPlatformAdmin, permissions]
    );

    const handlers = useMemo<UserActionHandlers>(() => canManage ? {
        onEdit: (user) => setForm({ open: true, user }),
        onPassword: setPassword,
        onResetTwoFactor: (user) => setConfirm({ kind: "reset-2fa", user }),
        onSignOut: (user) => setConfirm({ kind: "sign-out", user }),
        onDelete: (user) => setConfirm({ kind: "delete", user }),
    } : {}, [canManage]);

    // Only a platform admin gives or takes the role, which the server checks again. `userActions` leaves out the own row.
    const role = usePlatformAdminRole(afterChange);
    const askRole = role.ask;
    const onPlatformAdmin = useMemo(
        () => (platformRole && viewerPlatformAdmin ? (user: UserRow) => askRole({ userId: user.id, name: user.name || user.email, on: !user.superAdmin }) : undefined),
        [platformRole, viewerPlatformAdmin, askRole]
    );

    /** The handlers for one user, without what the viewer may not do to them. Edit stays for the group. */
    const handlersFor = useCallback((user: UserRow): UserActionHandlers => ({
        ...(lockOf(user)
            ? { ...handlers, onEdit: closed(user) ? undefined : handlers.onEdit, onPassword: undefined, onResetTwoFactor: undefined, onSignOut: undefined, onDelete: undefined }
            : handlers),
        onPlatformAdmin,
    }), [handlers, lockOf, closed, onPlatformAdmin]);

    const open = useCallback((user: UserRow) => setDetails({ id: user.id, open: true }), []);
    // A link like the search in the header opens one with `?open=`.
    useOpenFromLink(model?.users, open);
    const columns = useMemo(
        () => userColumns({ onOpen: open, tenantNameOf, renderActions: (user) => <BackupRowMenu name={user.name} groups={userActions(user, handlersFor(user))} /> }),
        [open, handlersFor, tenantNameOf]
    );

    const users = useMemo(() => model?.users ?? [], [model]);
    const rows = useMemo(() => users.filter(QUICK.find((option) => option.value === quick)?.keep ?? (() => true)), [users, quick]);
    const filters = useMemo(() => userFilters(users, tenantNameOf), [users, tenantNameOf]);
    const trash = useTrash("user", afterChange);
    const bulkActions = useMemo<BulkAction<UserRow>[]>(() => canManage ? [{
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "user" },
        icon: Trash,
        variant: "destructive",
        itemName: (user) => user.name,
        itemDetail: (user) => user.email,
        ineligible: lockOf,
        confirm: {
            title: (selected) => `Delete ${selected.length} user${selected.length === 1 ? "" : "s"}?`,
            description: () => "Their sessions end at once and their API keys stop working. The last platform admin and the last account are kept.",
            confirmLabel: "Delete",
        },
        trash: {
            ...trash,
            permanentLine: (selected) => (selected.length === 1
                ? "For an account that has to be gone at once. It skips Recently deleted with the password, second factor, passkeys and API keys."
                : "For accounts that have to be gone at once. They skip Recently deleted with their passwords, second factors, passkeys and API keys."),
        },
        run: (selected, { permanently }) => unwrapBulkAction(bulkDeleteUsers(selected.map((user) => user.id), { permanently })),
    }] : [], [canManage, lockOf, trash]);

    const shown = details ? users.find((user) => user.id === details.id) ?? null : null;
    const shownHandlers = shown ? handlersFor(shown) : {};

    return (
        <div className="flex flex-col gap-4 md:gap-0">
            <UsersStrip model={model} />
            {/* From md up the numbers and the list join the tabs above them into one card, so the banner moves under it. */}
            {withInvitations && <InvitationsBanner invitations={invitations} canManage={canManage} onRevoked={() => void reloadInvitations()} className="md:order-last md:mt-6" />}
            {/* Who of the MSP opens this tenant through a platform group, read only, under the list. */}
            {withInvitations && model && !allTenants && <PlatformPeoplePart tenantName={tenantName(activeTenantId)} className="md:order-last md:mt-6" />}

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
                                label: option.value === "no-group" && allTenants ? "No tenant" : option.label,
                                count: users.filter(option.keep).length,
                                ...(option.value === "no-group" && users.some(placeless) ? { dot: "bg-warning" } : {}),
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
                groups={groups}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onEdit={shownHandlers.onEdit}
                onPassword={shownHandlers.onPassword}
                onResetTwoFactor={shownHandlers.onResetTwoFactor}
                onSignOut={shownHandlers.onSignOut}
                lock={shown && canManage ? lockOf(shown) : null}
                groupsMenu={shown ? userActions(shown, shownHandlers, true) : []}
                onChanged={afterChange}
                canManageTenants={allTenants && managesTenants}
                managedTenants={model?.managedTenants ?? null}
                givableGroups={model?.givableGroups ?? null}
                canManagePlatformGroup={platformRole && canManage}
                version={version}
            />

            <UserDialog
                open={form.open}
                user={form.user}
                groups={groups}
                passwordRules={model?.passwordPolicy ?? null}
                viewerPlatformAdmin={viewerPlatformAdmin}
                allowNoGroup={model?.homeTenant ?? true}
                allTenants={allTenants}
                manageTenants={allTenants && managesTenants}
                tenantReach={{ managedTenants: model?.managedTenants ?? null, givableGroups: model?.givableGroups ?? null }}
                newUserReach={{ managedTenants: model?.newUserTenants ?? null, givableGroups: model?.newUserGroups ?? null }}
                managePlatformGroup={platformRole && canManage}
                onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                onSaved={afterChange}
            />

            {withInvitations && <InviteDialog
                open={inviting}
                groups={groups}
                viewerPlatformAdmin={viewerPlatformAdmin}
                onOpenChange={setInviting}
                onCreated={() => void reloadInvitations()}
            />}

            {password && (
                <UserPasswordDialog
                    user={password}
                    rules={model?.passwordPolicy ?? null}
                    onClose={() => setPassword(null)}
                    onDone={() => {
                        setPassword(null);
                        afterChange();
                    }}
                />
            )}
            {role.dialog}
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
                    onRestored={afterChange}
                />
            )}
        </div>
    );
}
