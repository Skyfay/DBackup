import prisma from "@/lib/prisma";

/**
 * The origins better-auth trusts. The address of DBackup itself, from `BETTER_AUTH_URL` and
 * `TRUSTED_ORIGINS`, for every request. The issuers of the sign-in providers only while better-auth
 * reads the endpoints of a provider: the SSO plugin asks the same list whether a discovery document
 * may be fetched and whether a token, user info or JWKS endpoint on a private address may be called,
 * on `/sign-in/sso` and on the GET of `/sso/callback/{providerId}`.
 *
 * Anywhere else an issuer would pass the checks better-auth makes of the `Origin` of a request and of
 * its `callbackURL`, so the host of a provider a tenant runs would count as DBackup itself. On
 * `/sign-in/sso` it is in the list, which is why `foreignSsoTarget` refuses such a target there.
 */

/** The address of DBackup and the further ones of `TRUSTED_ORIGINS`. */
export function ownOrigins(): string[] {
    const primary = process.env.BETTER_AUTH_URL || "http://localhost:3000";
    const additional = process.env.TRUSTED_ORIGINS
        ? process.env.TRUSTED_ORIGINS.split(",").map((url) => url.trim()).filter(Boolean)
        : [];
    return [primary, ...additional];
}

/** The paths of better-auth on which the SSO plugin reads the endpoints of a provider. */
function readsProviderEndpoints(request: Request | undefined): boolean {
    if (!request) return false;
    let path: string;
    try {
        path = new URL(request.url).pathname;
    } catch {
        return false;
    }
    return path.endsWith("/sign-in/sso") || path.includes("/sso/callback/");
}

/** The issuers of the providers that are on. */
async function issuers(): Promise<string[]> {
    try {
        const providers = await prisma.ssoProvider.findMany({ where: { enabled: true }, select: { issuer: true } });
        return providers.map((provider) => provider.issuer).filter((issuer): issuer is string => !!issuer);
    } catch {
        // During initial setup, DB might not be ready
        return [];
    }
}

/** The `trustedOrigins` of better-auth for one request. */
export async function trustedOriginsFor(request: Request | undefined): Promise<string[]> {
    const own = ownOrigins();
    return readsProviderEndpoints(request) ? [...own, ...(await issuers())] : own;
}

const originOf = (url: string): string | null => {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
};

/**
 * On `/sign-in/sso`, where the issuers are trusted for the endpoints of a provider, the first
 * address of the request that only an issuer would let pass: a `callbackURL`, `errorCallbackURL` or
 * `newUserCallbackURL` of the body, or the `Origin` the browser sent. Null when there is none, also
 * for an issuer on the address of DBackup itself. A relative path is never one.
 */
export async function foreignSsoTarget(path: string, body: unknown, headers: Headers | null | undefined): Promise<string | null> {
    if (path !== "/sign-in/sso") return null;
    const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const targets = [fields.callbackURL, fields.errorCallbackURL, fields.newUserCallbackURL, headers?.get("origin")]
        .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (targets.length === 0) return null;
    const own = new Set(ownOrigins().map(originOf).filter((origin): origin is string => !!origin));
    const foreign = new Set((await issuers()).map(originOf).filter((origin): origin is string => !!origin && !own.has(origin)));
    return targets.find((target) => {
        const origin = originOf(target);
        return origin !== null && foreign.has(origin);
    }) ?? null;
}
