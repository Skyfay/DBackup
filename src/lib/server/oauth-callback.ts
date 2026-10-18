/**
 * The shared part of the OAuth callbacks of Dropbox, Google Drive and OneDrive: who may bring an
 * authorization back, and how its refresh token is kept. The auth routes bind the `state` they
 * hand to the provider with `createOAuthState`, see `src/lib/auth/oauth-state.ts`.
 */

import { getAuthContext, hasPermissionWithContext, type AuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { consumeOAuthState, type OAuthProvider } from "@/lib/auth/oauth-state";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import type { OAuthData } from "@/lib/core/credentials";
import { requestHeaders } from "@/lib/server/request-headers";
import { auditService } from "@/services/audit-service";
import { credentialChanges, credentialSnapshot } from "@/services/auth/credential-audit";
import { updateCredentialProfile } from "@/services/auth/credential-service";

export type OAuthCallbackCaller =
    | { ok: true; ctx: AuthContext; credentialId: string }
    | { ok: false; message: string };

/**
 * The caller of a callback and the login its authorization was started for: a signed-in person
 * who may change saved logins, in the tenant the authorization started in, and the same person
 * who started it. The provider only hands the `state` back, so it names nothing by itself.
 */
export async function oauthCallbackCaller(provider: OAuthProvider, state: string): Promise<OAuthCallbackCaller> {
    const ctx = await getAuthContext(await requestHeaders()).catch(() => null);
    if (!ctx || ctx.authMethod !== "session") return { ok: false, message: "Authentication required. Please log in and try again." };
    if (!ctx.tenantId || !hasPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.WRITE)) {
        return { ok: false, message: "You may not change saved logins in this tenant." };
    }
    const bound = consumeOAuthState(state, { provider, userId: ctx.userId, tenantId: ctx.tenantId });
    if (!bound) return { ok: false, message: "This authorization ran out or belongs to another session. Start it again from the saved login." };
    return { ok: true, ctx, credentialId: bound.credentialId };
}

/**
 * Keeps the refresh token an authorization brought in its saved login, and notes the change in
 * the audit log of the tenant, the token marked as a secret that changed, never with its value.
 */
export async function saveRefreshToken(ctx: AuthContext, credentialId: string, profile: OAuthData, refreshToken: string): Promise<void> {
    const before = await credentialSnapshot(credentialId);
    const saved = await updateCredentialProfile(credentialId, {
        data: { clientId: profile.clientId, clientSecret: profile.clientSecret, refreshToken } satisfies OAuthData,
    });
    await auditService.logFor(
        ctx,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.CREDENTIAL,
        { name: saved.name, changes: credentialChanges(before, await credentialSnapshot(credentialId)) },
        credentialId
    );
}
