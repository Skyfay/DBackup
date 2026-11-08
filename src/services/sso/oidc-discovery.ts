import type { OIDCEndpoints } from "@/lib/core/oidc-adapter";
import { logger } from "@/lib/logging/logger";
import { userMessage } from "@/lib/logging/user-message";
import { getOIDCAdapter } from "./oidc-registry";

const log = logger.child({ service: "OidcDiscovery" });

/**
 * What a provider that does not answer reads. The words of the fetch or of the provider name the
 * hosts and addresses it tried, which a check of any address would hand back, so they stay in the log.
 */
export const PROVIDER_UNREACHABLE = "The provider could not be reached. Check its address, the server log has the details.";

/**
 * What the discovery found. `dialed` says whether it sent a request to the provider, which the check
 * of a provider writes into the audit log like a test of a connection. An unknown type, fields that
 * do not pass and a type whose endpoints are typed into its fields reach nothing.
 */
export type DiscoveryResult =
    | { ok: true; endpoints: OIDCEndpoints; config: Record<string, unknown>; dialed: boolean }
    | { ok: false; error: string; dialed: boolean };

/**
 * The provider types whose endpoints come from their fields as they are, without a request. Every
 * other type reads them from the provider, so a new type counts as one that dials unless it is named here.
 */
const READ_FROM_FIELDS: ReadonlySet<string> = new Set(["generic"]);

/**
 * Reads the endpoints of a provider from the fields of its type, like the URL of a Pocket ID, and
 * hands back the fields as checked, which are what gets saved. A provider reached over HTTPS that
 * names its endpoints over plain HTTP is refused: the reverse proxy in front of it misses
 * X-Forwarded-Proto, and a sign-in through it would fail later with a far worse message.
 */
export async function discoverEndpoints(adapterId: string, config: Record<string, unknown>): Promise<DiscoveryResult> {
    const adapter = getOIDCAdapter(adapterId);
    if (!adapter) return { ok: false, error: "This provider type does not exist.", dialed: false };

    const parsed = adapter.inputSchema.safeParse(config);
    if (!parsed.success) {
        const field = adapter.inputs.find((input) => input.name === parsed.error.issues[0]?.path[0]);
        return { ok: false, error: field ? `Check the ${field.label}.` : "Check the fields of the provider.", dialed: false };
    }

    // From here on the address of the caller's choosing is asked, also when the request fails or is refused.
    const dialed = !READ_FROM_FIELDS.has(adapter.id);
    let endpoints: OIDCEndpoints;
    try {
        endpoints = await adapter.getEndpoints(parsed.data);
    } catch (error: unknown) {
        return { ok: false, error: userMessage(error, PROVIDER_UNREACHABLE, log, "Reading the endpoints of a sign-in provider failed", { adapterId }), dialed };
    }
    if (!endpoints.authorizationEndpoint || !endpoints.tokenEndpoint || !endpoints.userInfoEndpoint) {
        return { ok: false, error: "The provider answered without the endpoints a sign-in needs.", dialed };
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
                dialed,
            };
        }
    }
    return { ok: true, endpoints, config: parsed.data, dialed };
}
