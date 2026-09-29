import prisma from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { calculateChecksum } from "@/lib/crypto/checksum";
import { diffFields, type AuditField, type AuditValue } from "@/lib/core/audit-diff";
import type { AuditChange } from "@/lib/core/audit-types";
import { sshFingerprint } from "@/lib/transport/openssh-key";

/**
 * A credential profile as the audit log compares it, in the words of its form. A secret field is
 * held only as a checksum, so neither a snapshot nor an entry ever carries the secret itself.
 */

/** Every field a profile can hold, the secret ones marked. */
const FIELDS: Record<string, AuditField> = {
    description: { label: "Description" },
    username: { label: "Username" },
    user: { label: "User" },
    authType: { label: "Sign in with" },
    accessKeyId: { label: "Access key ID" },
    clientId: { label: "Client ID" },
    publicKey: { label: "Key fingerprint" },
    password: { label: "Password", secret: true },
    privateKey: { label: "Private key", secret: true },
    passphrase: { label: "Key passphrase", secret: true },
    secretAccessKey: { label: "Secret access key", secret: true },
    token: { label: "Token", secret: true },
    url: { label: "Webhook URL", secret: true },
    authHeader: { label: "Auth header", secret: true },
    clientSecret: { label: "Client secret", secret: true },
    refreshToken: { label: "Refresh token", secret: true },
};

const AUTH_TYPES: Record<string, string> = { password: "Password", privateKey: "Private key", agent: "SSH agent" };

export interface CredentialSnapshot {
    name: string;
    values: Record<string, AuditValue>;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function readPayload(data: string): Record<string, unknown> {
    try {
        const value: unknown = JSON.parse(decrypt(data));
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
        // A payload that does not open compares as an empty one.
        return {};
    }
}

function valueOf(key: string, value: unknown): AuditValue {
    if (FIELDS[key]?.secret) return text(value) ? calculateChecksum(value as string) : null;
    // The public key is long, its fingerprint names it as well.
    if (key === "publicKey") return text(value) ? sshFingerprint(value as string) : null;
    if (key === "authType") return AUTH_TYPES[String(value)] ?? text(value);
    return text(value);
}

/** A profile before or after a change, null when there is none with this id. */
export async function credentialSnapshot(id: string): Promise<CredentialSnapshot | null> {
    const profile = await prisma.credentialProfile.findUnique({ where: { id }, select: { name: true, description: true, data: true } });
    if (!profile) return null;
    const payload = readPayload(profile.data);
    const values: Record<string, AuditValue> = { description: profile.description };
    for (const key of Object.keys(FIELDS)) {
        if (key !== "description") values[key] = valueOf(key, payload[key]);
    }
    return { name: profile.name, values };
}

/** The fields a change of a profile touched. A secret is marked as changed without its values. */
export function credentialChanges(before: CredentialSnapshot | null, after: CredentialSnapshot | null): AuditChange[] {
    if (!before || !after) return [];
    return diffFields(before.values, after.values, FIELDS);
}

/** The name of a profile, for an entry about it. Null when there is none with this id. */
export async function credentialName(id: string): Promise<string | null> {
    const profile = await prisma.credentialProfile.findUnique({ where: { id }, select: { name: true } });
    return profile?.name ?? null;
}
