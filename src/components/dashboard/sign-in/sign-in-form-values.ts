import { NO_GROUP } from "@/components/dashboard/users/user-columns";
import { freeGroupName } from "@/lib/auth/group-templates";
import { isEmailDomain, normalizeDomain } from "@/lib/auth/sso-domain";
import type { OIDCInput } from "@/lib/core/oidc-adapter";
import type { SsoProviderRow, SsoProvidersModel } from "@/services/sso/sso-providers-types";
import { defaultName, freeProviderId } from "./sign-in-adapters";

export type SignInFormMode = { kind: "create" } | { kind: "edit"; provider: SsoProviderRow };

/** What the form of a provider holds. */
export interface SignInValues {
    name: string;
    /** Only picked while it is new, it is part of the callback URL for good. */
    providerId: string;
    /** The fields of the provider type, like its URL. */
    config: Record<string, string>;
    clientId: string;
    clientSecret: string;
    /** Edit shows the saved secret as saved until Replace. A new provider always asks for one. */
    replaceSecret: boolean;
    domain: string;
    /** The tenant the provider belongs to, null for the platform. */
    tenantId: string | null;
    allowProvisioning: boolean;
    /** The id of a group, NO_GROUP, or empty while none is picked yet. */
    groupId: string;
}

/** Another provider as the form checks its domain against. */
export interface ClaimedDomain {
    name: string;
    domain: string | null;
}

export interface SignInProblem {
    /** "name", "providerId", "clientId", "clientSecret", "domain", "group", or "config." and the name of a field of the type. */
    field: string;
    message: string;
}

const PROVIDER_ID = /^[a-z0-9-_]+$/;

export function initialValues(mode: SignInFormMode, adapterId: string, inputs: OIDCInput[], model: SsoProvidersModel): SignInValues {
    if (mode.kind === "edit") {
        const { provider } = mode;
        return {
            name: provider.name,
            providerId: provider.providerId,
            config: Object.fromEntries(inputs.map((input) => [input.name, provider.config[input.name] ?? ""])),
            clientId: provider.clientId ?? "",
            clientSecret: "",
            replaceSecret: false,
            domain: provider.domain ?? "",
            tenantId: provider.tenant?.id ?? null,
            allowProvisioning: provider.allowProvisioning,
            groupId: provider.group?.id ?? NO_GROUP,
        };
    }
    return {
        name: freeGroupName(defaultName(adapterId), model.providers.map((provider) => provider.name)),
        providerId: freeProviderId(adapterId, model.providers.map((provider) => provider.providerId)),
        config: Object.fromEntries(inputs.map((input) => [input.name, input.defaultValue ?? ""])),
        clientId: "",
        clientSecret: "",
        replaceSecret: true,
        domain: "",
        tenantId: null,
        allowProvisioning: true,
        // Someone new without a group sees nothing, so a new provider asks for a pick.
        groupId: "",
    };
}

/**
 * The first thing that keeps the form from saving, in the order of the fields. The server checks
 * the same once more. A provider of a tenant is reached by its domain only and adds people to its
 * tenant, so it needs a domain and, while it adds people, a group of that tenant.
 */
export function problemOf(values: SignInValues, mode: SignInFormMode, inputs: OIDCInput[], takenIds: readonly string[], others: readonly ClaimedDomain[] = []): SignInProblem | null {
    if (!values.name.trim()) return { field: "name", message: "Give the provider a name." };
    if (mode.kind === "create") {
        const id = values.providerId.trim();
        if (!id || !PROVIDER_ID.test(id)) return { field: "providerId", message: "Use lowercase letters, numbers, dashes and underscores." };
        if (takenIds.includes(id)) return { field: "providerId", message: "Another provider has this ID." };
    }
    for (const input of inputs) {
        if (input.required && !values.config[input.name]?.trim()) return { field: `config.${input.name}`, message: `The ${input.label} is missing.` };
    }
    if (!values.clientId.trim()) return { field: "clientId", message: "The client ID is missing." };
    if (values.replaceSecret && !values.clientSecret) {
        return { field: "clientSecret", message: mode.kind === "create" ? "The client secret is missing." : "Paste the new secret, or keep the saved one." };
    }
    const domain = normalizeDomain(values.domain);
    if (domain && !isEmailDomain(domain)) return { field: "domain", message: "Type a domain like example.com, without the @." };
    if (!domain && values.tenantId) return { field: "domain", message: "A provider of a tenant is reached by its email domain only, so it needs one." };
    const owner = domain ? others.find((other) => normalizeDomain(other.domain) === domain) : undefined;
    if (owner) return { field: "domain", message: `${owner.name} signs in ${domain} already. A domain belongs to one provider.` };
    if (values.allowProvisioning && !values.groupId) return { field: "group", message: "Pick the group new people start in." };
    if (values.allowProvisioning && values.tenantId && values.groupId === NO_GROUP) return { field: "group", message: "A provider of a tenant adds people to the tenant, so it needs a group there for them." };
    return null;
}

/** The fields of the type as they are saved, trimmed and without the empty optional ones. */
export function configOf(values: SignInValues, inputs: OIDCInput[]): Record<string, string> {
    return Object.fromEntries(inputs.map((input) => [input.name, values.config[input.name]?.trim() ?? ""]).filter(([, value]) => value !== ""));
}

/** The group as the actions take it: an id, null for none, or left as it is while nothing is picked. */
export function groupIdOf(groupId: string): string | null | undefined {
    if (!groupId) return undefined;
    return groupId === NO_GROUP ? null : groupId;
}

/** Whether an edit changed anything, the secret counts once Replace holds a new one. */
export function changedFrom(initial: SignInValues, values: SignInValues): boolean {
    const plain = (entry: SignInValues) => JSON.stringify({ ...entry, name: entry.name.trim(), clientId: entry.clientId.trim(), domain: entry.domain.trim(), clientSecret: "", replaceSecret: false });
    return plain(initial) !== plain(values) || (values.replaceSecret && values.clientSecret !== "");
}
