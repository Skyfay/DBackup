import { NO_GROUP } from "@/components/dashboard/users/user-columns";
import { freeGroupName } from "@/lib/auth/group-templates";
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
    allowProvisioning: boolean;
    /** The id of a group, NO_GROUP, or empty while none is picked yet. */
    groupId: string;
}

export interface SignInProblem {
    /** "name", "providerId", "clientId", "clientSecret", "group", or "config." and the name of a field of the type. */
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
        allowProvisioning: true,
        // Someone new without a group sees nothing, so a new provider asks for a pick.
        groupId: "",
    };
}

/** The first thing that keeps the form from saving, in the order of the fields. */
export function problemOf(values: SignInValues, mode: SignInFormMode, inputs: OIDCInput[], takenIds: readonly string[]): SignInProblem | null {
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
    if (values.allowProvisioning && !values.groupId) return { field: "group", message: "Pick the group new people start in." };
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
