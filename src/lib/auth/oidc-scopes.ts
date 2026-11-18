/**
 * The scopes DBackup asks an OpenID Connect provider for, stored as `scopes` in the `oidcConfig` of
 * the provider, which the SSO plugin of better-auth reads. Without them it asks for its own default,
 * which adds `offline_access`. DBackup needs no refresh token, and Google refuses that scope (#198).
 */
export const OIDC_SCOPES: readonly string[] = ["openid", "profile", "email"];

/**
 * The scopes of a stored `oidcConfig`, as the plugin reads them, or the default when it names none.
 * A provider keeps a list someone set in its config by hand when it is saved again.
 */
export function scopesOf(oidcConfig: string | null | undefined): string[] {
    try {
        const scopes = oidcConfig ? JSON.parse(oidcConfig)?.scopes : undefined;
        if (Array.isArray(scopes) && scopes.length > 0 && scopes.every((scope) => typeof scope === "string" && scope.trim().length > 0)) {
            return scopes;
        }
    } catch {
        // A config that is no JSON gets the default, like one without scopes.
    }
    return [...OIDC_SCOPES];
}
