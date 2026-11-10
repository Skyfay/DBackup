/**
 * How better-auth links a sign-in provider to an account that exists already, shared by the auth
 * config and the test that runs its callback.
 *
 * - Linking is on, and the email of the provider may differ from the account's.
 * - Every enabled provider is trusted, see `loadTrustedProviders` in index.ts.
 * - An account whose email its owner set themselves (emailVerified false) is not refused here for
 *   every link, which better-auth does by default. The account hook in sso-tenant-guard.ts lets it
 *   link from its own session only, so the Link button of the profile and the first sign-in after an
 *   invitation work, while a provider never takes it over by its email alone.
 */
export function accountLinkingOptions(trustedProviders: string[]) {
    return {
        enabled: true,
        allowDifferentEmails: true,
        trustedProviders,
        requireLocalEmailVerified: false,
    };
}
