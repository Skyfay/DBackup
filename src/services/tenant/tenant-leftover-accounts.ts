import type { Tx } from "@/lib/prisma-tx";

/**
 * The accounts a deleted tenant leaves behind. An account of no tenant counts as one of the home
 * tenant (`userService.placelessTenantOf`), whose admins give it a group and whose sign-in
 * providers link it by its email. The admin of a customer chose the email and the password of the
 * accounts of their tenant, so one that worked there alone never comes to the home tenant able to
 * sign in: its sessions, its password, the links of its providers and its second factors go, and
 * its email counts as unverified, so no provider links it by the email alone (`allowTenantSsoLink`).
 * Whoever manages it afterwards sets a new password. An account that also works elsewhere, or that
 * a platform role or group holds, stays as it is.
 *
 * Runs in the transaction of the delete, before the memberships go with the tenant.
 *
 * @returns How many accounts lost their sign-in.
 */
export async function disarmAccountsOnlyOf(tx: Tx, tenantId: string): Promise<number> {
    const accounts = await tx.user.findMany({
        where: { platformRole: null, platformGroupId: null, memberships: { some: { tenantId }, every: { tenantId } } },
        select: { id: true },
    });
    const ids = accounts.map((account) => account.id);
    // In slices, a tenant may hold more accounts than one statement takes as variables.
    for (let start = 0; start < ids.length; start += 500) {
        const userId = { in: ids.slice(start, start + 500) };
        await tx.session.deleteMany({ where: { userId } });
        await tx.account.deleteMany({ where: { userId } });
        await tx.twoFactor.deleteMany({ where: { userId } });
        await tx.passkey.deleteMany({ where: { userId } });
        await tx.user.updateMany({ where: { id: userId }, data: { emailVerified: false, twoFactorEnabled: false, passkeyTwoFactor: false } });
    }
    return ids.length;
}
