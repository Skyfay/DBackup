import prisma from "@/lib/prisma";
import { reachCoversAccount, roleRefusal, type AccountActor } from "@/lib/auth/account-access";
import { permissionsIn, platformRightsOf } from "@/lib/auth/owner-permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { reachCovers, type PlatformReach } from "@/lib/auth/platform-group-caps";
import { runAsSystem } from "@/lib/tenant/context";
import { getPasswordPolicy } from "@/services/auth/password-policy-service";
import { membersOfAny } from "@/services/tenant/membership-service";
import { buildUsersModel, loadLogins } from "./users-model";
import type { UsersModel } from "./users-types";

/**
 * Every account of the instance once, with the group it holds in each of its tenants, the accounts
 * of no tenant included, with its platform group, and the groups of every tenant, for Users & Groups
 * of the Platform. Whoever may see the accounts of the platform may open it from inside any tenant,
 * so it reads every tenant. Someone of a platform group of some tenants sees the people of those
 * tenants and their own account, each with only those of its tenants, and the groups of the tenants
 * they reach or add people to. The password hashes of the accounts never leave the database.
 */
export async function getAllUsersModel(viewerId: string | null, viewerPlatformAdmin = true): Promise<UsersModel> {
    const scope = viewerPlatformAdmin || !viewerId ? null : scopeOf(await loadViewer(viewerId));
    const some = scope && scope.reach !== "all" ? scope.reach : null;
    // A group of some tenants also reads the groups of the tenants it adds people to as an admin there.
    const groupTenants = scope && some ? [...new Set([...some, ...candidateTenants(scope, some)])] : null;
    const [users, groups, providers, passwordPolicy] = await runAsSystem(() => Promise.all([
        prisma.user.findMany({
            where: some && viewerId ? { OR: [{ id: viewerId }, membersOfAny(some)] } : undefined,
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
                createdAt: true,
                twoFactorEnabled: true,
                passkeyTwoFactor: true,
                platformRole: true,
                platformGroupId: true,
                platformGroup: { select: { id: true, name: true } },
                memberships: { select: { tenantId: true, group: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
                accounts: { select: { providerId: true } },
                sessions: { select: { createdAt: true, expiresAt: true, userAgent: true, ipAddress: true } },
                // The keys of every tenant, which All tenants reads unfiltered, or of the tenants a group of some reaches.
                _count: { select: { apiKeys: some ? { where: { tenantId: { in: [...some] } } } : true, passkeys: true } },
            },
        }),
        // The groups of every tenant, each with its tenant, which a pick of the group per tenant offers.
        prisma.group.findMany({
            where: groupTenants ? { tenantId: { in: groupTenants } } : undefined,
            select: { id: true, name: true, permissions: true, fullAccess: true, tenantId: true, _count: { select: { memberships: true } } },
        }),
        prisma.ssoProvider.findMany({ select: { providerId: true, name: true, adapterId: true } }),
        getPasswordPolicy(),
    ]));

    // Of an account a group of some tenants learns only the tenants it reaches, and whether it works beyond them.
    const beyond = new Set(some ? users.filter((user) => !reachCoversAccount(some, user.memberships.map((membership) => membership.tenantId))).map((user) => user.id) : []);
    const shown = some ? users.map((user) => ({ ...user, memberships: user.memberships.filter((membership) => some.includes(membership.tenantId)) })) : users;
    const model = buildUsersModel({
        users: shown,
        groups,
        providers,
        logins: await loadLogins(users.map((user) => user.id)),
        viewerId,
        viewerPlatformAdmin,
        allTenants: true,
    });
    const platformGroups = new Map(users.map((user) => [user.id, user.platformGroup]));
    const reach = scope ? reachOfScope(scope, groups) : { managedTenants: null, givableGroups: null, newUserTenants: null, newUserGroups: null };
    // No tenant is open, so a new account picks its tenant, and its group, in the dialog.
    return {
        ...model,
        users: model.users.map((row) => ({
            ...row,
            platformGroup: platformGroups.get(row.id) ?? null,
            // The right to manage the accounts of the platform does not change it, see `accountRefusal`.
            ...(beyond.has(row.id) ? { beyondReach: true, elsewhere: true } : {}),
        })),
        passwordPolicy,
        homeTenant: false,
        ...reach,
    };
}

/** The viewer as the list of every account reads them: their groups in their tenants and their platform group. */
function loadViewer(viewerId: string) {
    return runAsSystem(() => prisma.user.findUnique({
        where: { id: viewerId },
        select: {
            memberships: { select: { tenantId: true, group: { select: { permissions: true, fullAccess: true } } } },
            platformGroup: { select: { platformPermissions: true, tenantPermissions: true, allTenants: true, tenants: { select: { tenantId: true } } } },
        },
    }));
}

/** What someone of a platform group may do on the list of every account. */
interface ViewerScope {
    /** The tenants their platform group reaches, see `platformGroupService.reachOf`. */
    reach: PlatformReach;
    /** Whether they hold the right to manage the accounts of the platform. */
    managesAccounts: boolean;
    /** The tenants they work in. */
    memberOf: string[];
    /** What they may do in a tenant, by their groups and their platform group. */
    actorIn: (tenantId: string) => AccountActor;
}

function scopeOf(viewer: Awaited<ReturnType<typeof loadViewer>>): ViewerScope {
    const platformGroup = viewer?.platformGroup ?? null;
    const held = new Map<string, string[]>();
    return {
        reach: !platformGroup ? [] : platformGroup.allTenants ? "all" : platformGroup.tenants.map((tenant) => tenant.tenantId),
        managesAccounts: platformRightsOf(platformGroup).includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE),
        memberOf: (viewer?.memberships ?? []).map((membership) => membership.tenantId),
        actorIn: (tenantId) => {
            if (!held.has(tenantId)) held.set(tenantId, permissionsIn(viewer?.memberships ?? [], tenantId, platformGroup));
            return { isPlatformAdmin: false, tenantId, permissions: held.get(tenantId) ?? [] };
        },
    };
}

/**
 * Whether New user may make an account in a tenant, like `createUser` checks it: one the right to
 * manage the accounts of the platform reaches, or one where the viewer may manage the users.
 */
function addsPeopleIn(scope: ViewerScope, tenantId: string): boolean {
    return (scope.managesAccounts && reachCovers(scope.reach, tenantId)) || scope.actorIn(tenantId).permissions.includes(PERMISSIONS.USERS.WRITE);
}

/** The tenants New user may make an account in for a platform group of some tenants: among those it reaches and those the viewer works in. */
function candidateTenants(scope: ViewerScope, reach: readonly string[]): string[] {
    return [...new Set([...reach, ...scope.memberOf])].filter((tenantId) => addsPeopleIn(scope, tenantId));
}

/**
 * Where someone of a platform group gives and takes the group of an account on this list, like
 * `setTenantMember` checks it: the tenants their platform group reaches, and there the groups that
 * may do no more than they may in that tenant. A membership in a tenant gives no right on the
 * platform. And where New user makes an account, like `createUser` checks it, with the groups it
 * may give there.
 */
function reachOfScope(scope: ViewerScope, groups: readonly { id: string; tenantId: string; permissions: string; fullAccess: boolean }[]) {
    const managedTenants = scope.reach === "all" ? null : [...scope.reach];
    const givableGroups = groups
        .filter((group) => (managedTenants === null || managedTenants.includes(group.tenantId)) && !roleRefusal(scope.actorIn(group.tenantId), group))
        .map((group) => group.id);
    // A group of all tenants that manages the accounts of the platform adds people to every tenant.
    const newUserTenants = scope.reach === "all"
        ? scope.managesAccounts ? null : [...new Set(groups.map((group) => group.tenantId))].filter((tenantId) => addsPeopleIn(scope, tenantId))
        : candidateTenants(scope, scope.reach);
    const newUserGroups = groups
        .filter((group) => (newUserTenants === null || newUserTenants.includes(group.tenantId)) && !roleRefusal(scope.actorIn(group.tenantId), group))
        .map((group) => group.id);
    return { managedTenants, givableGroups, newUserTenants, newUserGroups };
}

/** The tenants and groups someone of a platform group gives on the list of every account, see `reachOfScope`. */
export async function viewerReach(viewerId: string, groups: readonly { id: string; tenantId: string; permissions: string; fullAccess: boolean }[]) {
    return reachOfScope(scopeOf(await loadViewer(viewerId)), groups);
}
