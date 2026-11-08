import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { clientAddress } from "@/lib/core/client-address";
import { ALL_TENANTS } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { accountLogOrigin } from "@/services/audit/account-log";
import { ssoProviderIdOf, type SsoHookContext } from "./sso-guard";
import { signedInSessionOf } from "./sso-tenant-guard";

/** The change an entry of a provider linked to the own account names, which the Audit log tab reads. */
export const SSO_CONNECTED = "SSO account connected";

/**
 * Runs after better-auth linked an account to a provider. A link made while the account is signed
 * in already is the owner connecting a provider to their own account, from the profile or straight
 * through `/sign-in/sso`, so it goes into the audit log here, whichever page started it. The log is
 * the one `accountLogOrigin` picks for the tenant the session works in, like every change of the
 * own account. A link at a sign-in without a session is part of that sign-in, see `sign-in-audit.ts`.
 */
export async function recordSsoLink(account: { userId: string }, context: SsoHookContext | null | undefined): Promise<void> {
    const providerId = ssoProviderIdOf(context);
    if (!providerId) return;
    const session = await signedInSessionOf(context);
    if (session?.userId !== account.userId) return;

    const provider = await prisma.ssoProvider.findUnique({ where: { providerId }, select: { name: true } });
    const active = session.activeTenantId;
    const origin = await accountLogOrigin({ tenantId: active === ALL_TENANTS ? null : active, allTenants: active === ALL_TENANTS }, account.userId);
    const headers = context?.headers;
    await auditService.log(
        account.userId,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.AUTH,
        { change: SSO_CONNECTED, name: provider?.name ?? providerId, providerId },
        account.userId,
        { ...origin, ipAddress: headers ? clientAddress(headers) : null, userAgent: headers?.get("user-agent") ?? null }
    );
}
