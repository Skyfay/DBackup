"use client";

import { Building2 } from "lucide-react";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { cn } from "@/lib/utils";
import type { UserRow, UserTenantRole } from "@/services/user/users-types";

/**
 * The tenants of an account in All tenants, where the list holds every account once: a cell with
 * the tenants and the group in each, and the Tenant filter. The names come from the tenant view of
 * the dashboard, see `useTenantName`.
 */

/** The value of the Tenant filter for an account of no tenant. */
export const NO_TENANT = "none";

export type TenantNameOf = (tenantId: string) => string | null;

/** A membership with the name of its tenant, the id while the name is not known. */
export interface NamedTenantRole extends UserTenantRole {
    tenantName: string;
}

/** The tenants of an account by name, the home tenant first. */
export function namedTenants(roles: readonly UserTenantRole[], nameOf: TenantNameOf): NamedTenantRole[] {
    return roles
        .map((role) => ({ ...role, tenantName: nameOf(role.tenantId) ?? role.tenantId }))
        .sort((a, b) => Number(b.tenantId === HOME_TENANT_ID) - Number(a.tenantId === HOME_TENANT_ID) || a.tenantName.localeCompare(b.tenantName));
}

/** "Acme GmbH · Operators", what an account does in one tenant. */
export const tenantRoleLine = (role: NamedTenantRole) => `${role.tenantName} · ${role.group.name}`;

const tenantIdsOf = (user: UserRow) => {
    const ids = (user.tenants ?? []).map((role) => role.tenantId);
    return ids.length > 0 ? ids : [NO_TENANT];
};

/** A dashed amber "No tenant", since such an account signs in and sees nothing. */
export function NoTenantTag({ className }: { className?: string }) {
    return (
        <span
            className={cn("inline-flex h-5.5 items-center rounded-md border border-dashed border-warning/60 px-2 text-xs font-medium whitespace-nowrap text-warning", className)}
            title="Signs in, but sees and does nothing until someone adds them to a tenant"
        >
            No tenant
        </span>
    );
}

/** The first tenant of an account with its group, and how many more, all of them on hover. */
export function TenantsCell({ tenants, nameOf, className }: { tenants: readonly UserTenantRole[]; nameOf: TenantNameOf; className?: string }) {
    if (tenants.length === 0) return <NoTenantTag className={className} />;
    const named = namedTenants(tenants, nameOf);
    const [first, ...rest] = named;
    return (
        <span className={cn("flex min-w-0 items-center gap-1.5", className)} title={named.map(tenantRoleLine).join("\n")}>
            <TenantTileMark name={first.tenantName} className="size-5 rounded text-[9px]" />
            <span className="min-w-0 truncate text-sm">
                {first.tenantName}
                <span className="text-muted-foreground"> · {first.group.name}</span>
            </span>
            {rest.length > 0 && (
                <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">+{rest.length}</span>
            )}
        </span>
    );
}

/** The accessor of the Tenants column: the ids of the tenants, or `NO_TENANT`, each counted on its own by the filter. */
export const tenantsAccessor = tenantIdsOf;

/** The Tenant filter, with the tenants some account works in and No tenant. */
export function tenantFilter(users: readonly UserRow[], nameOf: TenantNameOf): DataTableFilterableColumn<UserRow> {
    const ids = new Set(users.flatMap((user) => (user.tenants ?? []).map((role) => role.tenantId)));
    const options = namedTenants([...ids].map((tenantId) => ({ tenantId, group: { id: "", name: "" } })), nameOf);
    return {
        id: "tenants",
        title: "Tenant",
        note: "The numbers count the users",
        unavailableLabel: "No users with the other filters",
        options: [
            ...options.map((role) => ({ value: role.tenantId, label: role.tenantName, lead: <TenantTileMark name={role.tenantName} className="size-4 rounded text-[8px]" /> })),
            ...(users.some((user) => (user.tenants ?? []).length === 0)
                ? [{ value: NO_TENANT, label: "No tenant", lead: <Building2 className="size-4 shrink-0 text-warning" /> }]
                : []),
        ],
    };
}
