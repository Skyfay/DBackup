import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { UserTenantRole } from "@/services/user/users-types";

/**
 * The tenants of an account as Edit user in All tenants holds them until Save: the group in each
 * tenant it keeps or joins, and what Save then changes, one membership at a time.
 */

/** The group of an account in one tenant, as the dialog holds it. */
export interface TenantRoleDraft {
    tenantId: string;
    groupId: string;
}

/** A membership Save writes: the group given in the tenant, null to take the account out of it. */
export interface TenantRoleChange {
    tenantId: string;
    groupId: string | null;
}

/** What a row of the dialog shows about a tenant next to its group. */
export type TenantRoleState = "same" | "changed" | "new" | "removed";

export interface TenantRoleRow {
    tenantId: string;
    tenantName: string;
    /** The group picked now, the one it had for a tenant it leaves. */
    groupId: string;
    state: TenantRoleState;
}

/** The memberships of an account as the dialog starts with them. */
export const draftsOf = (roles: readonly UserTenantRole[]): TenantRoleDraft[] => roles.map((role) => ({ tenantId: role.tenantId, groupId: role.group.id }));

/** What Save changes: a new or other group in a tenant, then the tenants it leaves. */
export function tenantRoleChanges(before: readonly UserTenantRole[], after: readonly TenantRoleDraft[]): TenantRoleChange[] {
    const was = new Map(before.map((role) => [role.tenantId, role.group.id]));
    const kept = new Set(after.map((role) => role.tenantId));
    return [
        ...after.filter((role) => was.get(role.tenantId) !== role.groupId).map((role) => ({ tenantId: role.tenantId, groupId: role.groupId })),
        ...before.filter((role) => !kept.has(role.tenantId)).map((role) => ({ tenantId: role.tenantId, groupId: null })),
    ];
}

/** Every tenant of the dialog with what Save does there, the home tenant first, then by name. */
export function tenantRoleRows(before: readonly UserTenantRole[], after: readonly TenantRoleDraft[], nameOf: (tenantId: string) => string | null): TenantRoleRow[] {
    const was = new Map(before.map((role) => [role.tenantId, role.group.id]));
    const kept = new Set(after.map((role) => role.tenantId));
    const rows: Omit<TenantRoleRow, "tenantName">[] = [
        ...after.map((role) => ({
            tenantId: role.tenantId,
            groupId: role.groupId,
            state: !was.has(role.tenantId) ? "new" as const : was.get(role.tenantId) === role.groupId ? "same" as const : "changed" as const,
        })),
        ...before.filter((role) => !kept.has(role.tenantId)).map((role) => ({ tenantId: role.tenantId, groupId: role.group.id, state: "removed" as const })),
    ];
    return rows
        .map((row) => ({ ...row, tenantName: nameOf(row.tenantId) ?? row.tenantId }))
        .sort((a, b) => Number(b.tenantId === HOME_TENANT_ID) - Number(a.tenantId === HOME_TENANT_ID) || a.tenantName.localeCompare(b.tenantName));
}

/** "Joins Acme, leaves Shop", the tenants Save changes, for the foot of the dialog. */
export function tenantChangeLine(changes: readonly TenantRoleChange[], before: readonly UserTenantRole[], nameOf: (tenantId: string) => string | null): string | null {
    const was = new Set(before.map((role) => role.tenantId));
    const names = (keep: (change: TenantRoleChange) => boolean) => changes.filter(keep).map((change) => nameOf(change.tenantId) ?? change.tenantId);
    const joins = names((change) => change.groupId !== null && !was.has(change.tenantId));
    const moves = names((change) => change.groupId !== null && was.has(change.tenantId));
    const leaves = names((change) => change.groupId === null);
    const parts = [
        ...(joins.length > 0 ? [`joins ${joins.join(", ")}`] : []),
        ...(moves.length > 0 ? [`another group in ${moves.join(", ")}`] : []),
        ...(leaves.length > 0 ? [`leaves ${leaves.join(", ")}`] : []),
    ];
    return parts.length > 0 ? `${parts.join(", ").charAt(0).toUpperCase()}${parts.join(", ").slice(1)}` : null;
}
