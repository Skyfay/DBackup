/**
 * The shape of the issuer of a sign-in provider. Its origin lifts the private address check of the
 * SSO plugin, see `trusted-origins.ts`, and better-auth reads `*` and `?` in a trusted origin as
 * wildcards. An issuer comes from the discovery document of a provider a customer may run, so an
 * issuer with a user part, a `*` or a `?` is refused where it is saved and never trusted.
 */

/** Why an issuer is no plain web address, as a sentence, or null when it is one. */
export function issuerProblem(issuer: string): string | null {
    let url: URL;
    try {
        url = new URL(issuer);
    } catch {
        return "The issuer of the provider is no web address.";
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return "The issuer of the provider is no http or https address.";
    if (url.username || url.password || /[*?]/.test(issuer)) return "The issuer of the provider holds a user part, a * or a ?, which no issuer has.";
    return null;
}
