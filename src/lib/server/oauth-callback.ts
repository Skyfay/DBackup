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
import { configBackupTargetRefusal } from "@/lib/server/config-backup-target-guard";
import { auditService } from "@/services/audit-service";
import { credentialChanges, credentialSnapshot } from "@/services/auth/credential-audit";
import { updateCredentialProfile } from "@/services/auth/credential-service";

/**
 * What a callback that broke shows on the destinations page. The error itself, which can carry the
 * answer of the provider or a path of the server, goes to the log.
 */
export const OAUTH_CALLBACK_FAILED = "The authorization could not be completed. See the server log for details.";

/**
 * What the validate-token routes answer for a check that failed for another reason than an expired
 * authorization. The answer of the provider goes to the log.
 */
export const TOKEN_CHECK_FAILED = "The authorization could not be checked. See the server log for details.";

/** What a callback shows when the provider reports a refused authorization, whatever it adds. */
export const OAUTH_DENIED = "Authorization was denied by the user.";

/** What the auth routes answer an API key, see `oauthStartRefusal`. */
export const OAUTH_START_SESSION_ONLY = "An authorization is started by a signed-in person, never with an API key.";

/**
 * Refuses the start of an authorization to an API key with 403. Only a signed-in person brings the
 * authorization back, see `oauthCallbackCaller`, so a key would only hand out a link to the consent
 * screen of the provider bound to its owner. Null for a session.
 */
export function oauthStartRefusal(ctx: Pick<AuthContext, "authMethod">): Response | null {
    if (ctx.authMethod === "session") return null;
    return Response.json({ success: false, error: OAUTH_START_SESSION_ONLY, message: OAUTH_START_SESSION_ONLY }, { status: 403 });
}

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
    // A new token of the login of the destination of the configuration backup comes only from a platform admin.
    const locked = await configBackupTargetRefusal(ctx, { credentialIds: [bound.credentialId] });
    if (locked) return { ok: false, message: locked };
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
