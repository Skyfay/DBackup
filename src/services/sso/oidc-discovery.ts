import type { OIDCEndpoints } from "@/lib/core/oidc-adapter";
import { getErrorMessage } from "@/lib/logging/errors";
import { getOIDCAdapter } from "./oidc-registry";

export type DiscoveryResult =
    | { ok: true; endpoints: OIDCEndpoints; config: Record<string, unknown> }
    | { ok: false; error: string };

/**
 * Reads the endpoints of a provider from the fields of its type, like the URL of a Pocket ID, and
 * hands back the fields as checked, which are what gets saved. A provider reached over HTTPS that
 * names its endpoints over plain HTTP is refused: the reverse proxy in front of it misses
 * X-Forwarded-Proto, and a sign-in through it would fail later with a far worse message.
 */
export async function discoverEndpoints(adapterId: string, config: Record<string, unknown>): Promise<DiscoveryResult> {
    const adapter = getOIDCAdapter(adapterId);
    if (!adapter) return { ok: false, error: "This provider type does not exist." };

    const parsed = adapter.inputSchema.safeParse(config);
    if (!parsed.success) {
        const field = adapter.inputs.find((input) => input.name === parsed.error.issues[0]?.path[0]);
        return { ok: false, error: field ? `Check the ${field.label}.` : "Check the fields of the provider." };
    }

    let endpoints: OIDCEndpoints;
    try {
        endpoints = await adapter.getEndpoints(parsed.data);
    } catch (error: unknown) {
        return { ok: false, error: `The provider could not be reached. ${getErrorMessage(error)}` };
    }
    if (!endpoints.authorizationEndpoint || !endpoints.tokenEndpoint || !endpoints.userInfoEndpoint) {
        return { ok: false, error: "The provider answered without the endpoints a sign-in needs." };
    }

    if (endpoints.discoveryEndpoint?.startsWith("https://")) {
        const insecure = [
            { name: "Authorization", url: endpoints.authorizationEndpoint },
            { name: "Token", url: endpoints.tokenEndpoint },
        ].filter((endpoint) => endpoint.url.startsWith("http://"));
        if (insecure.length > 0) {
            const names = insecure.map((endpoint) => endpoint.name).join(" and ");
            const urls = insecure.map((endpoint) => endpoint.url).join(", ");
            return {
                ok: false,
                error: `The provider is reached over HTTPS but names its ${names} endpoint over plain HTTP: ${urls}. The reverse proxy in front of it most likely does not send X-Forwarded-Proto.`,
            };
        }
    }
    return { ok: true, endpoints, config: parsed.data };
}
