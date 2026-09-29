/**
 * What the Sign-in tab says about each provider type: its name, what it asks for, and what to set
 * up on the side of the provider. The fields themselves come with the page model.
 */

export interface AdapterCopy {
    name: string;
    /** One line on its card in the first step of New provider. */
    needs: string;
    /** The three steps beside the fields, the second one names the callback URL below them. */
    setup: [string, string, string];
}

const COPY: Record<string, AdapterCopy> = {
    authentik: {
        name: "Authentik",
        needs: "The base URL and the slug of the DBackup application in Authentik",
        setup: [
            "Create an OAuth2/OpenID provider and an application named DBackup in Authentik",
            "Paste this callback URL as the redirect URI of the provider",
            "Copy the client ID and secret of the provider into the fields",
        ],
    },
    authelia: {
        name: "Authelia",
        needs: "The URL of Authelia is enough, every endpoint is read from it",
        setup: [
            "Add a client for DBackup to the OpenID Connect clients in the configuration of Authelia",
            "Put this callback URL in its redirect URIs",
            "Copy its client ID and the secret it had before it was hashed into the fields",
        ],
    },
    keycloak: {
        name: "Keycloak",
        needs: "The URL of Keycloak and the realm the client lives in",
        setup: [
            "Create an OpenID Connect client named DBackup in the realm, with client authentication on",
            "Add this callback URL to its valid redirect URIs",
            "Copy its client ID, and the secret from its Credentials tab, into the fields",
        ],
    },
    "pocket-id": {
        name: "Pocket ID",
        needs: "The URL of Pocket ID is enough, every endpoint is read from it",
        setup: [
            "Create an OIDC client named DBackup in Pocket ID",
            "Paste this callback URL as its callback URL",
            "Copy its client ID and secret into the fields",
        ],
    },
    generic: {
        name: "Any OpenID Connect provider",
        needs: "The issuer and every endpoint by hand, for Zitadel, Kanidm or any other",
        setup: [
            "Create an OpenID Connect client for DBackup in the provider",
            "Allow this callback URL as its redirect URI",
            "Copy its client ID and secret into the fields",
        ],
    },
};

/** The types with a card of their own in the first step, the generic one comes last on its own. */
export const NAMED_ADAPTERS = ["authentik", "authelia", "keycloak", "pocket-id"];

export const GENERIC_ADAPTER = "generic";

/** What DBackup asks a provider for. */
export const SSO_SCOPES = "openid profile email";

export function adapterCopy(adapterId: string, fallbackName = adapterId): AdapterCopy {
    return COPY[adapterId] ?? { name: fallbackName, needs: "", setup: COPY.generic.setup };
}

/** The name a provider of this type gets by itself, "OpenID Connect" for the generic one. */
export const defaultName = (adapterId: string) => (adapterId === GENERIC_ADAPTER ? "OpenID Connect" : adapterCopy(adapterId).name);

/** The provider ID a new provider gets: its type, with a number once that is taken. */
export function freeProviderId(adapterId: string, taken: readonly string[]): string {
    const used = new Set(taken);
    if (!used.has(adapterId)) return adapterId;
    let number = 2;
    while (used.has(`${adapterId}-${number}`)) number += 1;
    return `${adapterId}-${number}`;
}
