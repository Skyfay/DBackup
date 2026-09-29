import type { SsoProvider } from "@prisma/client";
import { calculateChecksum } from "@/lib/crypto/checksum";
import { diffFields, type AuditField, type AuditValue } from "@/lib/core/audit-diff";
import type { AuditChange } from "@/lib/core/audit-types";
import { getOIDCAdapter } from "./oidc-registry";

/**
 * What an edit of a sign-in provider changed, in the words of its dialog. The client secret, and
 * every field of the provider type that is a password, is written as changed without its values.
 */

/** A provider as read from the database, with its client id and secret in plain text. */
export type ProviderState = Pick<SsoProvider, "adapterId" | "adapterConfig" | "providerId" | "domain" | "clientId" | "clientSecret" | "allowProvisioning">;

const FIELDS: Record<string, AuditField> = {
    providerId: { label: "Provider ID" },
    domain: { label: "Email domain" },
    clientId: { label: "Client ID" },
    clientSecret: { label: "Client secret", secret: true },
    allowProvisioning: { label: "Auto-provisioning" },
};

/** A secret as something to compare, never as its value. */
const secretMark = (value: unknown) => (typeof value === "string" && value !== "" ? calculateChecksum(value) : null);

function parseConfig(value: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

const text = (value: unknown): AuditValue => (typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null);

export function ssoProviderChanges(before: ProviderState, after: ProviderState): AuditChange[] {
    const fields: Record<string, AuditField> = { ...FIELDS };
    const values = (provider: ProviderState): Record<string, AuditValue> => ({
        providerId: provider.providerId,
        domain: provider.domain,
        clientId: provider.clientId,
        clientSecret: secretMark(provider.clientSecret),
        allowProvisioning: provider.allowProvisioning,
    });
    const from = values(before);
    const to = values(after);

    // The fields of the provider type, like the URL and realm of a Keycloak.
    const beforeConfig = parseConfig(before.adapterConfig);
    const afterConfig = parseConfig(after.adapterConfig);
    for (const input of getOIDCAdapter(after.adapterId)?.inputs ?? []) {
        const key = `adapterConfig.${input.name}`;
        const secret = input.type === "password";
        fields[key] = secret ? { label: input.label, secret: true } : { label: input.label };
        from[key] = secret ? secretMark(beforeConfig[input.name]) : text(beforeConfig[input.name]);
        to[key] = secret ? secretMark(afterConfig[input.name]) : text(afterConfig[input.name]);
    }
    return diffFields(from, to, fields);
}
