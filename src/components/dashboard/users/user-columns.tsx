"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Fingerprint, Globe, KeyRound, Lock, Minus, Users } from "lucide-react";
import { PlatformGroupTag } from "@/components/dashboard/platform/platform-group-cells";
import { getOidcProviderIcon } from "@/components/oidc/provider-icon";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { DateDisplay } from "@/components/utils/date-display";
import type { SignInMethod, UserRow } from "@/services/user/users-types";
import { CountCell, GroupTag, LastSignInCell, MethodsCell, SecondFactorCell, UserCell } from "./user-cells";
import { namedTenants, onPlatform, tenantFilter, TenantsCell, tenantsAccessor, type TenantNameOf } from "./user-tenants";

/** The value of the Group filter for a user without one. */
export const NO_GROUP = "none";

const groupOf = (user: UserRow) => user.group?.id ?? NO_GROUP;

/** The value of the Platform group filter: Platform admin, the id of the platform group, or none. */
const PLATFORM_ADMIN = "platform-admin";
const platformGroupOf = (user: UserRow) => (user.superAdmin ? PLATFORM_ADMIN : user.platformGroup?.id ?? NO_GROUP);

/** The platform group of every account, on the list of every account of the Platform. */
const platformGroupColumn: ColumnDef<UserRow> = {
    id: "platformGroup",
    header: "Platform group",
    accessorFn: platformGroupOf,
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
    sortingFn: (a, b) => Number(b.original.superAdmin) - Number(a.original.superAdmin) || (a.original.platformGroup?.name ?? "~").localeCompare(b.original.platformGroup?.name ?? "~"),
    cell: ({ row }) => <div className="max-w-44"><PlatformGroupTag user={row.original} /></div>,
};

const methodKey = (method: SignInMethod) => (method.kind === "sso" ? `sso:${method.providerId}` : method.kind);
const methodsOf = (user: UserRow) => user.methods.map(methodKey);

interface ColumnOptions {
    onOpen: (user: UserRow) => void;
    renderActions: (user: UserRow) => React.ReactNode;
    /** In All tenants the names of the tenants, which turns the Group column into Tenants. */
    tenantNameOf?: TenantNameOf;
}

/** The tenants of every account with the group in each, for All tenants, in place of the group of one tenant. */
function tenantsColumn(nameOf: TenantNameOf): ColumnDef<UserRow> {
    const first = (user: UserRow) => namedTenants(user.tenants ?? [], nameOf)[0]?.tenantName ?? "";
    return {
        id: "tenants",
        header: "Tenants",
        accessorFn: tenantsAccessor,
        // An account counts once for each tenant in the numbers of the filter, not as one list.
        getUniqueValues: tenantsAccessor,
        filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((tenantId) => value.includes(tenantId)),
        sortingFn: (a, b) => (a.original.tenants?.length ?? 0) - (b.original.tenants?.length ?? 0) || first(a.original).localeCompare(first(b.original)),
        cell: ({ row }) => <TenantsCell tenants={row.original.tenants ?? []} nameOf={nameOf} platform={onPlatform(row.original)} className="max-w-64" />,
    };
}

/** The columns of the users. User and actions stay put, the rest can move and hide. */
export function userColumns({ onOpen, renderActions, tenantNameOf }: ColumnOptions): ColumnDef<UserRow>[] {
    const group: ColumnDef<UserRow> = tenantNameOf ? tenantsColumn(tenantNameOf) : {
        id: "group",
        header: "Group",
        accessorFn: groupOf,
        filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
        sortingFn: (a, b) => (a.original.group?.name ?? "").localeCompare(b.original.group?.name ?? ""),
        cell: ({ row }) => <GroupTag group={row.original.group} />,
    };
    return [
        {
            accessorKey: "name",
            header: "User",
            meta: { pin: "start" },
            // The search of the table finds a user by name or by email.
            filterFn: (row, _id, value: string) => {
                const query = value.trim().toLowerCase();
                return !query || row.original.name.toLowerCase().includes(query) || row.original.email.toLowerCase().includes(query);
            },
            cell: ({ row, table }) => <UserCell user={row.original} compact={table.options.meta?.density === "compact"} onOpen={onOpen} />,
        },
        ...(tenantNameOf ? [platformGroupColumn] : []),
        group,
        {
            id: "methods",
            header: "Signs in with",
            // A user counts once for each way in the numbers of the filter, not as one list.
            accessorFn: methodsOf,
            getUniqueValues: methodsOf,
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((method) => value.includes(method)),
            enableSorting: false,
            cell: ({ row }) => <MethodsCell methods={row.original.methods} className="max-w-72" />,
        },
        {
            accessorKey: "secondFactor",
            header: "2FA",
            cell: ({ row }) => <SecondFactorCell value={row.original.secondFactor} />,
        },
        {
            id: "lastSignIn",
            header: "Last sign-in",
            accessorFn: (user) => (user.lastSignIn ? Date.parse(user.lastSignIn.at) : 0),
            cell: ({ row }) => <div className="max-w-48"><LastSignInCell user={row.original} /></div>,
        },
        {
            accessorKey: "sessions",
            header: () => <div className="text-right">Sessions</div>,
            meta: { label: "Sessions" },
            cell: ({ row }) => <CountCell value={row.original.sessions} />,
        },
        {
            accessorKey: "apiKeys",
            header: () => <div className="text-right">API keys</div>,
            meta: { label: "API keys" },
            cell: ({ row }) => <CountCell value={row.original.apiKeys} />,
        },
        {
            id: "created",
            header: "Created",
            accessorFn: (user) => Date.parse(user.createdAt),
            meta: { defaultHidden: true },
            cell: ({ row }) => <span className="text-sm whitespace-nowrap"><DateDisplay date={row.original.createdAt} format="P" /></span>,
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            meta: { pin: "end", label: "Actions" },
            enableHiding: false,
            enableSorting: false,
            cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
        },
    ];
}

/** The Group, or in All tenants the Tenant, and the Signs in with filters, with only the values some user has. */
export function userFilters(users: UserRow[], tenantNameOf?: TenantNameOf): DataTableFilterableColumn<UserRow>[] {
    const shared = { note: "The numbers count the users", unavailableLabel: "No users with the other filters" };
    const groups = new Map(users.flatMap((user) => (user.group ? [[user.group.id, user.group.name] as const] : [])));
    const methods = new Map<string, SignInMethod>();
    for (const method of users.flatMap((user) => user.methods)) methods.set(methodKey(method), method);
    const order = (method: SignInMethod) => (method.kind === "password" ? 0 : method.kind === "passkey" ? 1 : 2);

    const platformGroups = new Map(users.flatMap((user) => (user.platformGroup ? [[user.platformGroup.id, user.platformGroup.name] as const] : [])));
    return [
        ...(tenantNameOf ? [{
            id: "platformGroup",
            title: "Platform group",
            ...shared,
            options: [
                ...(users.some((user) => user.superAdmin) ? [{ value: PLATFORM_ADMIN, label: "Platform admin", lead: <Lock className="size-4 shrink-0 text-muted-foreground" /> }] : []),
                ...[...platformGroups.entries()]
                    .sort((a, b) => a[1].localeCompare(b[1]))
                    .map(([id, name]) => ({ value: id, label: name, lead: <Globe className="size-4 shrink-0 text-muted-foreground" /> })),
                ...(users.some((user) => !user.superAdmin && !user.platformGroup) ? [{ value: NO_GROUP, label: "No platform group", lead: <Minus className="size-4 shrink-0 text-muted-foreground" /> }] : []),
            ],
        }] : []),
        tenantNameOf ? tenantFilter(users, tenantNameOf) : {
            id: "group",
            title: "Group",
            ...shared,
            options: [
                ...[...groups.entries()]
                    .sort((a, b) => a[1].localeCompare(b[1]))
                    .map(([id, name]) => ({ value: id, label: name, lead: <Users className="size-4 shrink-0 text-muted-foreground" /> })),
                ...(users.some((user) => !user.group) ? [{ value: NO_GROUP, label: "No group", lead: <Users className="size-4 shrink-0 text-warning" /> }] : []),
            ],
        },
        {
            id: "methods",
            title: "Signs in with",
            ...shared,
            options: [...methods.values()]
                .sort((a, b) => order(a) - order(b) || (a.kind === "sso" && b.kind === "sso" ? a.name.localeCompare(b.name) : 0))
                .map((method) => {
                    const Icon = method.kind === "password" ? KeyRound : method.kind === "passkey" ? Fingerprint : getOidcProviderIcon(method.adapterId);
                    return {
                        value: methodKey(method),
                        label: method.kind === "password" ? "Password" : method.kind === "passkey" ? "Passkey" : method.name,
                        group: method.kind === "sso" ? "Single sign-on" : "DBackup",
                        lead: <Icon className="size-4 shrink-0 text-muted-foreground" />,
                    };
                }),
        },
    ];
}
