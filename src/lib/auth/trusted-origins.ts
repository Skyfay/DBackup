import prisma from "@/lib/prisma";
import { rangesOfColumn, toRanges } from "@/lib/network/local-network";
import { firstBlockedAddress } from "@/lib/network/reach-check";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * The origins better-auth trusts. The address of DBackup itself, from `BETTER_AUTH_URL` and
 * `TRUSTED_ORIGINS`, for every request. The issuers of the sign-in providers only while better-auth
 * reads the endpoints of a provider: the SSO plugin asks the same list whether a discovery document
 * may be fetched and whether a token, user info or JWKS endpoint on a private address may be called,
 * on `/sign-in/sso` and on the GET of `/sso/callback/{providerId}`.
 *
 * The plugin skips its check of private addresses for an endpoint on a trusted origin. That is
 * meant for a provider of the platform, which may sit in the local network. The provider of a
 * customer's tenant that reaches no local network (`Tenant.blocksLocalNetwork`) must not get past
 * that setting through its issuer, so its issuer is trusted only while its host leads to no address
 * of the local network outside the ranges the tenant is allowed, see `endpointIssuers`.
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

/** The issuers of the providers that are on, every one, for `foreignSsoTarget`. */
async function issuers(): Promise<string[]> {
    try {
        const providers = await prisma.ssoProvider.findMany({ where: { enabled: true }, select: { issuer: true } });
        return providers.map((provider) => provider.issuer).filter((issuer): issuer is string => !!issuer);
    } catch {
        // During initial setup, DB might not be ready
        return [];
    }
}

/** The provider a callback signs in through, from `/sso/callback/{providerId}`, null on any other path. */
function callbackProviderOf(request: Request): string | null {
    try {
        const match = /\/sso\/callback\/([^/]+)$/.exec(new URL(request.url).pathname);
        return match ? decodeURIComponent(match[1]) : null;
    } catch {
        return null;
    }
}

const hostOf = (issuer: string): string | null => {
    try {
        // An IPv6 literal without its brackets, the way the resolver reads it.
        return new URL(issuer).hostname.replace(/^\[|\]$/g, "") || null;
    } catch {
        return null;
    }
};

/**
 * The issuers whose origin lifts the private address check of the SSO plugin for one request. A
 * provider of the platform or of the home tenant always, and one of a tenant that reaches the local
 * network. The provider of a tenant that blocks it only while the host of its issuer leads to no
 * blocked address, checked now like the hosts of its connections. A host that does not resolve is
 * not trusted, since nothing says where it leads. A callback asks only about its own provider among
 * those, so the name of one customer that resolves slowly holds up no sign-in of another.
 */
async function endpointIssuers(request: Request): Promise<string[]> {
    try {
        const providers = (await prisma.ssoProvider.findMany({ where: { enabled: true }, select: { providerId: true, issuer: true, tenantId: true } }))
            .filter((provider): provider is typeof provider & { issuer: string } => !!provider.issuer);
        const tenantIds = [...new Set(providers.map((provider) => provider.tenantId).filter((id): id is string => !!id && id !== HOME_TENANT_ID))];
        const blocking = tenantIds.length === 0
            ? []
            : await prisma.tenant.findMany({ where: { id: { in: tenantIds }, blocksLocalNetwork: true }, select: { id: true, allowedNetworks: true } });
        const allowedOf = new Map(blocking.map((tenant) => [tenant.id, toRanges(rangesOfColumn(tenant.allowedNetworks))]));
        const callbackProvider = callbackProviderOf(request);
        const trusted = await Promise.all(providers.map(async (provider) => {
            const allowed = provider.tenantId ? allowedOf.get(provider.tenantId) : undefined;
            if (!allowed) return true;
            if (callbackProvider !== null && provider.providerId !== callbackProvider) return false;
            const host = hostOf(provider.issuer);
            if (!host) return false;
            try {
                return (await firstBlockedAddress([host], allowed)) === null;
            } catch {
                return false;
            }
        }));
        return providers.filter((_, index) => trusted[index]).map((provider) => provider.issuer);
    } catch {
        // During initial setup, DB might not be ready
        return [];
    }
}

/** The `trustedOrigins` of better-auth for one request. */
export async function trustedOriginsFor(request: Request | undefined): Promise<string[]> {
    const own = ownOrigins();
    return request && readsProviderEndpoints(request) ? [...own, ...(await endpointIssuers(request))] : own;
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
