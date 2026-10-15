import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";
import { getPasswordPolicy } from "@/services/auth/password-policy-service";
import { buildUsersModel, loadLogins } from "./users-model";
import type { UsersModel } from "./users-types";

/**
 * Every account of the instance once, with the group it holds in each of its tenants, the accounts
 * of no tenant included, with its platform group, and the groups of every tenant, for Users & Groups
 * of the Platform. Whoever may see the accounts of the platform may open it from inside any tenant,
 * so it reads every tenant. The password hashes of the accounts never leave the database.
 */
export async function getAllUsersModel(viewerId: string | null, viewerPlatformAdmin = true): Promise<UsersModel> {
    const [users, groups, providers, passwordPolicy] = await runAsSystem(() => Promise.all([
        prisma.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
                createdAt: true,
                twoFactorEnabled: true,
                passkeyTwoFactor: true,
                platformRole: true,
                platformGroup: { select: { id: true, name: true } },
                memberships: { select: { tenantId: true, group: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
                accounts: { select: { providerId: true } },
                sessions: { select: { createdAt: true, expiresAt: true, userAgent: true, ipAddress: true } },
                // The keys of every tenant, which All tenants reads unfiltered.
                _count: { select: { apiKeys: true, passkeys: true } },
            },
        }),
        // The groups of every tenant, each with its tenant, which a pick of the group per tenant offers.
        prisma.group.findMany({ select: { id: true, name: true, permissions: true, fullAccess: true, tenantId: true, _count: { select: { memberships: true } } } }),
        prisma.ssoProvider.findMany({ select: { providerId: true, name: true, adapterId: true } }),
        getPasswordPolicy(),
    ]));

    const model = buildUsersModel({
        users,
        groups,
        providers,
        logins: await loadLogins(users.map((user) => user.id)),
        viewerId,
        viewerPlatformAdmin,
        allTenants: true,
    });
    const platformGroups = new Map(users.map((user) => [user.id, user.platformGroup]));
    // No tenant is open, so a new account picks its tenant, and its group, in the dialog.
    return {
        ...model,
        users: model.users.map((row) => ({ ...row, platformGroup: platformGroups.get(row.id) ?? null })),
        passwordPolicy,
        homeTenant: false,
    };
}
