/**
 * The reach of the tenant of a sign-in provider, for the fetches the SSO plugin makes to it.
 *
 * During a sign-in through a provider and its callback, the plugin of better-auth fetches the
 * discovery document, the token, the user info and the keys from the endpoints of the provider.
 * A customer runs the provider of their tenant, and the DNS of its names, so a tenant that blocks
 * the local network would reach it anyway through a name that answers one address when DBackup
 * checks it and another one when the plugin connects. So the request runs with the reach policy of
 * the tenant of its provider, and the `fetch` of the process (`src/lib/auth/index.ts`) sends every
 * fetch of that request through `pinnedFetch`, whose sockets dial only checked addresses.
 */

import { AsyncLocalStorage } from "async_hooks";

import prisma from "@/lib/prisma";
import { domainOfEmail, normalizeDomain } from "@/lib/auth/sso-domain";
import type { ReachPolicy } from "@/lib/network/reach-policy";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { tenantReach } from "@/services/tenant/tenant-network";

/** On globalThis, since every bundle of Next.js loads this module anew and the fetch reads one of them. */
const store = ((globalThis as unknown as { ssoFetchReach?: AsyncLocalStorage<ReachPolicy> }).ssoFetchReach ??= new AsyncLocalStorage<ReachPolicy>());

/** The reach the fetches of the request that runs now keep to, null for none. */
export function ssoFetchReach(): ReachPolicy | null {
    return store.getStore() ?? null;
}

/** The provider a request of the SSO plugin signs in through, by the path of a callback or the body of a sign-in. */
async function providerOfRequest(request: Request): Promise<{ providerId?: string; domain?: string } | null> {
    let path: string;
    try {
        path = new URL(request.url).pathname;
    } catch {
        return null;
    }
    const callback = /\/sso\/callback\/([^/]+)$/.exec(path);
    if (callback) return { providerId: decodeURIComponent(callback[1]) };
    if (!path.endsWith("/sign-in/sso") || request.method !== "POST") return null;
    try {
        const body = (await request.clone().json()) as { providerId?: unknown; email?: unknown };
        if (typeof body.providerId === "string" && body.providerId) return { providerId: body.providerId };
        const domain = typeof body.email === "string" ? domainOfEmail(body.email) : null;
        return domain ? { domain } : null;
    } catch {
        return null;
    }
}

/** The reach policy of the tenant of the provider a request signs in through, null for one that reaches the local network. */
async function reachOfRequest(request: Request): Promise<ReachPolicy | null> {
    const named = await providerOfRequest(request);
    if (!named) return null;
    const providers = await prisma.ssoProvider.findMany({
        where: named.providerId ? { providerId: named.providerId } : { domain: { not: null } },
        select: { domain: true, tenantId: true },
    });
    const provider = named.providerId ? providers[0] : providers.find((candidate) => normalizeDomain(candidate.domain) === named.domain);
    // A provider of the platform or of the home tenant reaches what DBackup reaches.
    if (!provider?.tenantId || provider.tenantId === HOME_TENANT_ID) return null;
    return (await tenantReach(provider.tenantId)).policy;
}

/** Runs a request of better-auth with the reach of the tenant of its sign-in provider, see the module. */
export async function withSsoFetchReach<T>(request: Request, run: () => Promise<T>): Promise<T> {
    const reach = await reachOfRequest(request).catch(() => null);
    return reach ? store.run(reach, run) : run();
}
