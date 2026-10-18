import { AVAILABLE_PERMISSIONS, PERMISSIONS, PLATFORM_ONLY_PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * What a person may do by their roles. A role is the same in every tenant, and a membership says
 * which role someone holds in which tenant. An API key never does more than its owner may in the
 * tenant of the key, so this is the ceiling of every key too.
 */

export interface OwnerGroup {
    /** As stored, a JSON list. */
    permissions: string;
    /** The role with every permission, which the stored list of earlier versions may lack. */
    fullAccess: boolean;
}

export interface OwnerMembership {
    tenantId: string;
    group: OwnerGroup;
}

const ALL = AVAILABLE_PERMISSIONS.map((permission) => permission.id);
/** The rights on the platform only a platform group gives, never a group of a tenant. */
const PLATFORM_ONLY: string[] = PLATFORM_ONLY_PERMISSIONS.map((permission) => permission.id);
/** What no group gives, a platform admin alone holds. */
const ADMIN_ONLY: string[] = [PERMISSIONS.PLATFORM.SIGN_IN_WRITE];

/** The value of `User.platformRole` that sees and changes every tenant and the platform. */
export const PLATFORM_ADMIN_ROLE = "ADMIN";

/**
 * The permissions that act on the whole instance, its settings. They count from the role in the
 * home tenant only, so the admin of a customer never reaches them. Groups belong to a tenant, so
 * the right to manage them counts in each tenant like any other.
 */
export const PLATFORM_PERMISSIONS: ReadonlySet<string> = new Set(Object.values(PERMISSIONS.SETTINGS));

/** What someone may change of their own account, which belongs to no tenant. Any of their roles gives it. */
export const PROFILE_PERMISSIONS: ReadonlySet<string> = new Set(Object.values(PERMISSIONS.PROFILE));

/**
 * What a platform admin may do in All tenants, which shows every tenant at once and changes what
 * none of them holds: every read, the settings and the roles of the instance, the accounts and the
 * own profile. A change of a connection, a job or a backup happens in its tenant.
 */
export const ALL_TENANTS_PERMISSIONS: readonly string[] = [
    ...ALL.filter((permission) =>
        permission.endsWith(":read")
        || permission.endsWith(":view")
        || PLATFORM_PERMISSIONS.has(permission)
        || PROFILE_PERMISSIONS.has(permission)
        || permission === PERMISSIONS.USERS.WRITE),
    ...PLATFORM_ONLY,
    ...ADMIN_ONLY,
];

/**
 * Every permission there is, those of a tenant and those of the platform, which a platform admin
 * holds, with the ones no group gives at all, like changing the sign-in providers.
 */
export const EVERY_PERMISSION: readonly string[] = [...ALL, ...PLATFORM_ONLY, ...ADMIN_ONLY];

/** Whether a permission acts on the platform itself and only a platform group gives it. */
export const isPlatformOnly = (permission: string) => PLATFORM_ONLY.includes(permission);

/** Every permission for the full access role, the stored ones DBackup knows for any other, nothing without a role. */
export function groupPermissions(group: OwnerGroup | null | undefined): string[] {
    if (!group) return [];
    if (group.fullAccess) return [...ALL];
    let stored: unknown;
    try {
        stored = JSON.parse(group.permissions);
    } catch {
        return [];
    }
    const held = new Set(Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : []);
    return ALL.filter((permission) => held.has(permission));
}

/** A platform group as the rights of its members read it. */
export interface PlatformGroupGrant {
    /** As stored, a JSON list. */
    platformPermissions: string;
    /** As stored, a JSON list. */
    tenantPermissions: string;
    /** Every tenant, the ones made later too. */
    allTenants: boolean;
    /** The tenants of its scope while it does not cover every tenant. */
    tenants: readonly { tenantId: string }[];
}

function storedList(json: string): Set<string> {
    let stored: unknown;
    try {
        stored = JSON.parse(json);
    } catch {
        return new Set();
    }
    return new Set(Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : []);
}

/** The rights on the platform a platform group gives: the settings of the instance and the platform's own. */
export function platformRightsOf(group: PlatformGroupGrant | null | undefined): string[] {
    if (!group) return [];
    const held = storedList(group.platformPermissions);
    return [...ALL.filter((permission) => PLATFORM_PERMISSIONS.has(permission)), ...PLATFORM_ONLY].filter((permission) => held.has(permission));
}

/** Whether a platform group reaches a tenant: every tenant, or one of those it lists. */
export function reachesTenant(group: PlatformGroupGrant | null | undefined, tenantId: string | null): boolean {
    if (!group || !tenantId) return false;
    return group.allTenants || group.tenants.some((tenant) => tenant.tenantId === tenantId);
}

/** The rights a platform group gives in a tenant of its scope, on top of the group someone holds there. */
export function platformTenantRightsIn(group: PlatformGroupGrant | null | undefined, tenantId: string | null): string[] {
    if (!group || !reachesTenant(group, tenantId)) return [];
    const held = storedList(group.tenantPermissions);
    return ALL.filter((permission) => held.has(permission) && !PLATFORM_PERMISSIONS.has(permission));
}

/**
 * Whether a platform group opens All tenants: it reaches every tenant and sees something there.
 * A group of some tenants never does, All tenants would show the others too.
 */
export function opensAllTenants(group: PlatformGroupGrant | null | undefined): boolean {
    if (!group?.allTenants) return false;
    const held = storedList(group.tenantPermissions);
    return ALL.some((permission) => held.has(permission) && (permission.endsWith(":read") || permission.endsWith(":view")));
}

/**
 * What someone of a platform group may do in All tenants: the reads its rights in the tenants
 * give, its rights on the platform, and the settings and the profile of their own groups.
 */
export function allTenantsPermissionsOf(memberships: readonly OwnerMembership[], group: PlatformGroupGrant | null | undefined): string[] {
    const held = new Set(permissionsIn(memberships, null, group));
    if (group?.allTenants) {
        for (const permission of storedList(group.tenantPermissions)) {
            if (permission.endsWith(":read") || permission.endsWith(":view")) held.add(permission);
        }
    }
    return EVERY_PERMISSION.filter((permission) => held.has(permission) && ALL_TENANTS_PERMISSIONS.includes(permission));
}

/**
 * What someone may do while working in a tenant: what their role there gives, the settings and the
 * roles of the instance from their role in the home tenant, and the own profile from any role.
 * A platform group adds its rights in the tenants of its scope and its rights on the platform.
 * With one tenant and no platform group this is exactly what their role gives.
 */
export function permissionsIn(memberships: readonly OwnerMembership[], tenantId: string | null, platformGroup?: PlatformGroupGrant | null): string[] {
    const held = new Set<string>();
    const active = tenantId ? memberships.find((membership) => membership.tenantId === tenantId) : undefined;
    for (const permission of groupPermissions(active?.group)) {
        if (!PLATFORM_PERMISSIONS.has(permission)) held.add(permission);
    }
    const home = memberships.find((membership) => membership.tenantId === HOME_TENANT_ID);
    for (const permission of groupPermissions(home?.group)) {
        if (PLATFORM_PERMISSIONS.has(permission)) held.add(permission);
    }
    for (const membership of memberships) {
        for (const permission of groupPermissions(membership.group)) {
            if (PROFILE_PERMISSIONS.has(permission)) held.add(permission);
        }
    }
    for (const permission of platformTenantRightsIn(platformGroup, tenantId)) held.add(permission);
    for (const permission of platformRightsOf(platformGroup)) held.add(permission);
    // Someone of the MSP changes their own profile, also without a group in any tenant.
    if (platformGroup) for (const permission of PROFILE_PERMISSIONS) held.add(permission);
    return EVERY_PERMISSION.filter((permission) => held.has(permission));
}

/**
 * The rights of the platform a key of the home tenant may carry: managing the tenants with their
 * members and invitations, and the accounts, for the automation of an MSP. Never in the key of a
 * customer, whose tenant is no place to act on the platform from.
 */
export const HOME_KEY_PLATFORM_PERMISSIONS: readonly string[] = [
    PERMISSIONS.PLATFORM.TENANTS_READ,
    PERMISSIONS.PLATFORM.TENANTS_WRITE,
    PERMISSIONS.PLATFORM.ACCOUNTS_READ,
    PERMISSIONS.PLATFORM.ACCOUNTS_WRITE,
];

/**
 * The rights of the platform a key may carry in the tenant of the key: sharing the databases of its
 * servers, for a hosting panel that gives a customer the database it creates, in a tenant that shares
 * them (`Tenant.sharesWithCustomers`), and in the home tenant the tenants and the accounts
 * (`HOME_KEY_PLATFORM_PERMISSIONS`). Never the sign-in providers, nor the settings of the instance
 * through the platform group.
 */
export function keyPlatformPermissions(tenantShares: boolean, homeTenant = false): string[] {
    return [
        ...(homeTenant ? HOME_KEY_PLATFORM_PERMISSIONS : []),
        ...(tenantShares ? [PERMISSIONS.PLATFORM.SHARING_READ, PERMISSIONS.PLATFORM.SHARING_WRITE] : []),
    ];
}

/**
 * What the owner of an API key may do in the tenant of the key, the ceiling of the key: every
 * permission of a tenant for a platform admin, else what their roles and the tenant part of their
 * platform group give there. Of the rights a platform group gives on the platform, the settings of
 * the instance included, a key holds only what `keyPlatformPermissions` allows in its tenant, and
 * only while its owner holds them: a platform admin, or a platform group that gives them. What such
 * a key reaches stays the reach of its owner (`platformGroupService.reachOf`). The key itself never
 * passes the checks only a platform admin passes.
 */
export function ownerPermissionsIn(owner: { platformRole: string | null; memberships: readonly OwnerMembership[]; platformGroup?: PlatformGroupGrant | null }, tenantId: string, tenantShares = false): string[] {
    const keyable = keyPlatformPermissions(tenantShares, tenantId === HOME_TENANT_ID);
    if (owner.platformRole === PLATFORM_ADMIN_ROLE) return [...ALL, ...keyable];
    const tenantPart = owner.platformGroup ? { ...owner.platformGroup, platformPermissions: "[]" } : null;
    const platform = platformRightsOf(owner.platformGroup).filter((permission) => keyable.includes(permission));
    return [...permissionsIn(owner.memberships, tenantId, tenantPart).filter((permission) => !PLATFORM_ONLY.includes(permission)), ...platform];
}

/** The permissions of a key its owner may use right now. What the owner lost stays stored but does nothing. */
export function capToOwner(keyPermissions: readonly string[], ownerPermissions: readonly string[]): string[] {
    const allowed = new Set(ownerPermissions);
    return keyPermissions.filter((permission) => allowed.has(permission));
}
