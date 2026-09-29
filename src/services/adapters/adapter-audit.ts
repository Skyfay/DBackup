import prisma from "@/lib/prisma";
import { SENSITIVE_KEYS, redactSecrets } from "@/lib/crypto";
import { calculateChecksum } from "@/lib/crypto/checksum";
import { configFieldLabel } from "@/lib/adapters/field-label";
import { diffFields, type AuditField, type AuditValue } from "@/lib/core/audit-diff";
import type { AuditChange } from "@/lib/core/audit-types";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";

/**
 * What an edit of a connection changed, in the words of its form, for the audit log. Secrets are
 * compared but never kept: a new password or token is written as changed, without either value.
 */

/** Fields that can carry a secret without being stored encrypted, like extra headers with a token. */
const UNENCRYPTED_SECRETS = ["customHeaders"];

/** The longest value an entry keeps of a field, so a pasted payload template does not fill the log. */
const MAX_VALUE = 200;

/** The switches a connection keeps in its metadata, each stored the other way round. */
const FLAGS = {
    healthNotificationsDisabled: "Health alerts",
    isRestoreExcluded: "Restore target",
    skipVerification: "Integrity checks",
} as const;

/** The columns of a connection an edit can change besides its name and its config. */
export interface ConnectionColumns {
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
    storageRole?: string | null;
    metadata?: string | null;
}

/** The config of a connection before and after an edit in plain text, when the edit sent one. */
export interface ConfigPair {
    before: unknown;
    after: unknown;
}

const isSecretKey = (key: string) => SENSITIVE_KEYS.includes(key) || UNENCRYPTED_SECRETS.includes(key);

/** A secret as something to compare, never as its value. */
function secretMark(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;
    return calculateChecksum(typeof value === "string" ? value : JSON.stringify(value));
}

const plainObject = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** One entry of a list field, like a Firebird alias with its path. */
function itemText(item: unknown): string {
    if (!item || typeof item !== "object") return String(item);
    const { name, path } = item as { name?: unknown; path?: unknown };
    if (typeof name === "string") return typeof path === "string" && path ? `${name} (${path})` : name;
    return JSON.stringify(redactSecrets(item));
}

/** A value of a config field as a person reads it. */
function configValue(value: unknown): AuditValue {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map(itemText);
    return JSON.stringify(redactSecrets(value));
}

function configChanges({ before, after }: ConfigPair): AuditChange[] {
    const from = plainObject(before);
    const to = plainObject(after);
    const fields: Record<string, AuditField> = {};
    const fromValues: Record<string, AuditValue> = {};
    const toValues: Record<string, AuditValue> = {};
    for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
        const secret = isSecretKey(key);
        fields[key] = secret ? { label: configFieldLabel(key), secret: true } : { label: configFieldLabel(key) };
        fromValues[key] = secret ? secretMark(from[key]) : configValue(from[key]);
        toValues[key] = secret ? secretMark(to[key]) : configValue(to[key]);
    }
    return diffFields(fromValues, toValues, fields);
}

function parseMetadata(value: string | null | undefined): Record<string, unknown> {
    if (!value) return {};
    try {
        return plainObject(JSON.parse(value));
    } catch {
        return {};
    }
}

const roleText = (role: string | null | undefined) =>
    role === STORAGE_ROLES.SOURCE ? "Directory source" : role === STORAGE_ROLES.DESTINATION ? "Destination" : null;

/** The names of the credential profiles among these ids. */
async function profileNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (wanted.length === 0) return new Map();
    const rows = await prisma.credentialProfile.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
    return new Map(rows.map((row) => [row.id, row.name]));
}

async function columnChanges(type: string, before: ConnectionColumns, after: ConnectionColumns): Promise<AuditChange[]> {
    const loginsChanged = (before.primaryCredentialId ?? null) !== (after.primaryCredentialId ?? null)
        || (before.sshCredentialId ?? null) !== (after.sshCredentialId ?? null);
    const names = loginsChanged
        ? await profileNames([before.primaryCredentialId, before.sshCredentialId, after.primaryCredentialId, after.sshCredentialId])
        : new Map<string, string>();
    const login = (id: string | null | undefined) => (id ? names.get(id) ?? "A deleted profile" : null);

    const fields: Record<string, AuditField> = {
        primaryCredentialId: { label: "Login" },
        sshCredentialId: { label: "SSH login" },
        ...(type === "storage" ? { storageRole: { label: "Role" } } : {}),
        ...Object.fromEntries(Object.entries(FLAGS).map(([key, label]) => [key, { label }])),
    };
    const values = (columns: ConnectionColumns): Record<string, AuditValue> => {
        const metadata = parseMetadata(columns.metadata);
        return {
            primaryCredentialId: login(columns.primaryCredentialId),
            sshCredentialId: login(columns.sshCredentialId),
            storageRole: roleText(columns.storageRole),
            // On means on, like the switches of the form.
            ...Object.fromEntries(Object.keys(FLAGS).map((key) => [key, metadata[key] !== true])),
        };
    };
    return diffFields(values(before), values(after), fields);
}

const clip = (value: string | null) => (value && value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value);

/**
 * What an edit of a connection changed: its config fields, the logins it uses, its role and its
 * switches. `configs` is left out when the edit sent no config, which then stayed as it was.
 */
export async function connectionChanges(type: string, before: ConnectionColumns, after: ConnectionColumns, configs?: ConfigPair): Promise<AuditChange[]> {
    const changes = [...(configs ? configChanges(configs) : []), ...(await columnChanges(type, before, after))];
    return changes.map((change) => (change.secret ? change : { ...change, from: clip(change.from), to: clip(change.to) }));
}

/** The name of a connection, for an entry about something at it. Null when it is gone. */
export async function connectionName(id: string): Promise<string | null> {
    const row = await prisma.adapterConfig.findUnique({ where: { id }, select: { name: true } });
    return row?.name ?? null;
}
