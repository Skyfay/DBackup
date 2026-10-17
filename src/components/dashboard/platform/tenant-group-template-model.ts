import { freeGroupName, type GroupTemplate } from "@/lib/auth/group-templates";
import { PLATFORM_PERMISSIONS } from "@/lib/auth/owner-permissions";
import { lockedAllTenants, lockedTenant, lockedTenantRight, type PlatformGroupActor, type PlatformGroupShape } from "@/lib/auth/platform-group-caps";
import type { GroupMember, GroupRow, TenantGroupTemplateRow } from "@/services/user/groups-types";
import type { ScopeValue } from "./platform-group-scope";

/**
 * The rules of the groups the platform makes for tenants on Users & Groups of the Platform, as plain
 * functions: a group for tenants as a row of the list of every tenant's groups, what the caps read
 * of it, and the tenants that have a group of their own by its name.
 */

const PREFIX = "template:";

/** The id of the row of the built-in Admin, which is one group with every permission in each tenant. */
const BUILT_IN_ADMIN = "built-in:admin";

/** Whether a row is the built-in Admin of every tenant. */
export const isBuiltInRow = (row: Pick<GroupRow, "id">) => row.id === BUILT_IN_ADMIN;

/**
 * The built-in Admin as one row: each tenant has its own group with every permission, which nobody
 * changes or deletes and which always holds every permission, so the list shows them once, with
 * everyone who holds one. None without a tenant.
 */
export function adminRow(groups: readonly GroupRow[]): GroupRow | null {
    const admins = groups.filter((group) => group.superAdmin);
    if (admins.length === 0) return null;
    const members = new Map<string, GroupMember>();
    for (const group of admins) for (const member of group.members) members.set(member.id, member);
    return {
        id: BUILT_IN_ADMIN,
        name: "Admin",
        superAdmin: true,
        fromPlatform: true,
        permissions: [],
        members: [...members.values()].sort((a, b) => a.name.localeCompare(b.name)),
        createdAt: admins.map((group) => group.createdAt).sort()[0],
        made: null,
        changed: null,
    };
}

/** Whether a row of the list is a group for tenants rather than a group of one tenant. */
export const isTemplateRow = (row: Pick<GroupRow, "id">) => row.id.startsWith(PREFIX);

/** The id of the group for tenants a row stands for. */
export const templateIdOf = (row: Pick<GroupRow, "id">) => row.id.slice(PREFIX.length);

/** A group for tenants as a row of the list: its permissions, and everyone who holds it in any tenant. */
export function templateRow(template: TenantGroupTemplateRow): GroupRow {
    const members = new Map<string, GroupMember>();
    for (const group of template.groups) for (const member of group.members) members.set(member.id, member);
    return {
        id: `${PREFIX}${template.id}`,
        name: template.name,
        superAdmin: false,
        fromPlatform: true,
        permissions: template.permissions,
        members: [...members.values()].sort((a, b) => a.name.localeCompare(b.name)),
        createdAt: template.createdAt,
        made: template.made,
        changed: template.changed,
    };
}

/** What the caps of the platform groups read of a group for tenants: rights in the tenants and where, none on the platform. */
export function templateShape(values: { permissions: readonly string[]; allTenants: boolean; tenantIds: readonly string[] }): PlatformGroupShape {
    return { platformPermissions: [], tenantPermissions: [...values.permissions], allTenants: values.allTenants, tenantIds: values.allTenants ? [] : [...values.tenantIds] };
}

/** The tenants with a group of their own by the name, which a save asks about, by tenant. */
export function ownByName(groups: readonly GroupRow[], name: string): Map<string, GroupRow> {
    const wanted = name.trim();
    return new Map(groups.filter((group) => !group.fromPlatform && group.tenantId && group.name === wanted).map((group) => [group.tenantId!, group]));
}

/** The other groups of a tenant its members can move to, by name. */
export function groupsIn(groups: readonly GroupRow[], tenantId: string, exceptId?: string): GroupRow[] {
    return groups.filter((group) => group.tenantId === tenantId && group.id !== exceptId).sort((a, b) => a.name.localeCompare(b.name));
}

/** "All tenants, new ones too", "3 tenants" or "No tenant", what the list shows of where it reaches. */
export function reachLabel(template: Pick<TenantGroupTemplateRow, "allTenants" | "groups">): string {
    if (template.allTenants) return "All tenants";
    const count = template.groups.length;
    return count === 0 ? "No tenant" : `${count} ${count === 1 ? "tenant" : "tenants"}`;
}

/** What a new group for tenants starts with, picked in the first step. */
export type TenantGroupStart = { kind: "custom" } | { kind: "template"; template: GroupTemplate } | { kind: "copy"; template: TenantGroupTemplateRow };

/** The permissions a group for tenants keeps of a preset, never the settings of the instance. */
export const presetRights = (template: GroupTemplate) => template.permissions.filter((permission) => !PLATFORM_PERMISSIONS.has(permission));

export interface TenantGroupDraft {
    name: string;
    held: string[];
    scope: ScopeValue;
    /** Something of the start was left out, since the viewer may not give it. */
    trimmed: boolean;
}

const scopeOf = (template: TenantGroupTemplateRow): ScopeValue => ({ allTenants: template.allTenants, tenantIds: template.allTenants ? [] : template.groups.map((group) => group.tenantId) });

/**
 * What the editor starts with: the group itself, or for a new one its start, named free of the
 * other groups for tenants and without what the viewer may not give.
 */
export function draftOf(template: TenantGroupTemplateRow | null, start: TenantGroupStart | null, actor: PlatformGroupActor, taken: readonly string[]): TenantGroupDraft {
    if (template) return { name: template.name, held: template.permissions, scope: scopeOf(template), trimmed: false };
    const names = [...taken, "Admin"];
    if (!start || start.kind === "custom") return { name: "", held: [], scope: { allTenants: false, tenantIds: [] }, trimmed: false };
    const wanted = start.kind === "template" ? presetRights(start.template) : start.template.permissions;
    const held = wanted.filter((permission) => lockedTenantRight(actor, permission) === null);
    if (start.kind === "template") return { name: freeGroupName(start.template.groupName, names), held, scope: { allTenants: false, tenantIds: [] }, trimmed: held.length < wanted.length };
    const copy = scopeOf(start.template);
    const allTenants = copy.allTenants && lockedAllTenants(actor) === null;
    const tenantIds = copy.tenantIds.filter((tenantId) => lockedTenant(actor, tenantId) === null);
    return {
        name: freeGroupName(`${start.template.name} copy`, names),
        held,
        scope: { allTenants, tenantIds },
        trimmed: held.length < wanted.length || allTenants !== copy.allTenants || tenantIds.length < copy.tenantIds.length,
    };
}

/** "Client", "a copy of Support" or "Custom", what a new group for tenants started as. */
export const startName = (start: TenantGroupStart | null) =>
    !start || start.kind === "custom" ? "Custom" : start.kind === "template" ? start.template.label : `a copy of ${start.template.name}`;
