/**
 * A record moves to Recently deleted as a snapshot of itself and everything that belongs to it, taken
 * in the transaction that deletes it. Secrets stay as they were stored, encrypted with ENCRYPTION_KEY.
 */

import type { Account, AdapterConfig, ApiKey, CredentialProfile, DbVersionHistory, EncryptionProfile, Job, JobDestination, JobNotificationTemplate, JobSource, Passkey, TwoFactor, User, UserPreference } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { PERMISSIONS, getWritePermissionForAdapterType } from "@/lib/auth/permissions";
import type { Tx } from "@/lib/prisma-tx";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { keyIdOf } from "@/services/vault/key-id";
import type { TrashKind } from "./trash-types";

export interface KeySnapshot { record: EncryptionProfile }
export interface CredentialSnapshot { record: CredentialProfile }
export interface ConnectionSnapshot {
    record: AdapterConfig;
    /** The versions a database server had, which the Database Explorer shows. Health checks start again. */
    versionHistory?: DbVersionHistory[];
}
export interface JobSnapshot {
    record: Job;
    destinations: JobDestination[];
    sources: (JobSource & { presetIds: string[] })[];
    templates: JobNotificationTemplate[];
    /** Notification channels the job names directly. */
    channelIds: string[];
    /** Its runs, whose link to it the delete cleared and a restore sets again. */
    executionIds: string[];
}
export interface UserSnapshot {
    record: User;
    accounts: Account[];
    twoFactor: TwoFactor | null;
    passkeys: Passkey[];
    apiKeys: ApiKey[];
    preferences: UserPreference[];
    /** The picture, its bytes in base64 since the snapshot is JSON. */
    avatar?: { mimeType: string; size: number; data: string; updatedAt: Date } | null;
}

interface Snapshot {
    name: string;
    detail: string | null;
    data: unknown;
    permission: string;
    superAdminOnly?: boolean;
}

const CREDENTIAL_TYPES: Record<string, string> = {
    USERNAME_PASSWORD: "Username and password",
    SSH_KEY: "SSH key",
    ACCESS_KEY: "Access key",
    TOKEN: "Token",
    SMTP: "SMTP login",
    WEBHOOK: "Webhook",
    OAUTH: "OAuth",
};

function connectionKind(record: Pick<AdapterConfig, "type" | "storageRole">): string {
    if (record.type === "database") return "Database";
    if (record.type === "notification") return "Notification channel";
    return record.storageRole === STORAGE_ROLES.SOURCE ? "Folder source" : "Destination";
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const SNAPSHOTS: Record<TrashKind, (tx: Tx, id: string) => Promise<Snapshot>> = {
    async encryptionKey(tx, id) {
        const record = await tx.encryptionProfile.findUniqueOrThrow({ where: { id } });
        let keyId: string | null = null;
        try {
            keyId = keyIdOf(decrypt(record.secretKey));
        } catch {
            // Listed without its Key ID.
        }
        const data: KeySnapshot = { record };
        return { name: record.name, detail: keyId ? `Key ID ${keyId}` : null, data, permission: PERMISSIONS.VAULT.WRITE };
    },

    async credential(tx, id) {
        const record = await tx.credentialProfile.findUniqueOrThrow({ where: { id } });
        const data: CredentialSnapshot = { record };
        return { name: record.name, detail: CREDENTIAL_TYPES[record.type] ?? record.type, data, permission: PERMISSIONS.CREDENTIALS.DELETE };
    },

    async connection(tx, id) {
        const record = await tx.adapterConfig.findUniqueOrThrow({ where: { id } });
        const versionHistory = await tx.dbVersionHistory.findMany({ where: { adapterConfigId: id } });
        const data: ConnectionSnapshot = { record, versionHistory };
        return { name: record.name, detail: `${connectionKind(record)} · ${record.adapterId}`, data, permission: getWritePermissionForAdapterType(record.type) };
    },

    async job(tx, id) {
        const record = await tx.job.findUniqueOrThrow({ where: { id } });
        const [destinations, sources, templates, channels, executions] = await Promise.all([
            tx.jobDestination.findMany({ where: { jobId: id }, include: { config: { select: { name: true } } } }),
            tx.jobSource.findMany({ where: { jobId: id }, include: { excludePatternPresets: { select: { id: true } } } }),
            tx.jobNotificationTemplate.findMany({ where: { jobId: id } }),
            tx.job.findUnique({ where: { id }, select: { notifications: { select: { id: true } } } }),
            tx.execution.findMany({ where: { jobId: id }, select: { id: true } }),
        ]);
        const source = record.sourceId ? await tx.adapterConfig.findUnique({ where: { id: record.sourceId }, select: { name: true } }) : null;
        const data: JobSnapshot = {
            record,
            destinations: destinations.map(({ config: _config, ...destination }) => destination),
            sources: sources.map(({ excludePatternPresets, ...rest }) => ({ ...rest, presetIds: excludePatternPresets.map((preset) => preset.id) })),
            templates,
            channelIds: channels?.notifications.map((channel) => channel.id) ?? [],
            executionIds: executions.map((execution) => execution.id),
        };
        const from = source?.name ?? (sources.length > 0 ? plural(sources.length, "folder", "folders") : null);
        const to = destinations.map((destination) => destination.config.name).join(", ");
        const detail = [from, to].filter(Boolean).join(" to ") || null;
        return { name: record.name, detail, data, permission: PERMISSIONS.JOBS.WRITE };
    },

    async user(tx, id) {
        const found = await tx.user.findUniqueOrThrow({
            where: { id },
            include: { accounts: true, twoFactor: true, passkeys: true, apiKeys: true, preferences: true, avatar: true, group: { select: { name: true } } },
        });
        const { accounts, twoFactor, passkeys, apiKeys, preferences, avatar, group, ...record } = found;
        const picture = avatar && { mimeType: avatar.mimeType, size: avatar.size, data: Buffer.from(avatar.data).toString("base64"), updatedAt: avatar.updatedAt };
        const data: UserSnapshot = { record, accounts, twoFactor, passkeys, apiKeys, preferences, avatar: picture };
        return {
            name: record.name || record.email,
            detail: [record.email, group?.name ?? "no group"].join(" · "),
            data,
            permission: PERMISSIONS.USERS.WRITE,
            // Bringing back a SuperAdmin makes someone a SuperAdmin, which only a SuperAdmin decides.
            superAdminOnly: group?.name === "SuperAdmin",
        };
    },
};

/**
 * Keeps a record in Recently deleted, inside the transaction that deletes it, and answers with the
 * id it has there. `by` is the user who deletes.
 */
export async function keepInTrash(tx: Tx, kind: TrashKind, id: string, by?: string | null): Promise<string> {
    const snapshot = await SNAPSHOTS[kind](tx, id);
    const actor = by ? await tx.user.findUnique({ where: { id: by }, select: { name: true, email: true } }) : null;
    const row = await tx.deletedRecord.create({
        data: {
            kind,
            recordId: id,
            name: snapshot.name,
            detail: snapshot.detail,
            data: JSON.stringify(snapshot.data),
            permission: snapshot.permission,
            superAdminOnly: snapshot.superAdminOnly ?? false,
            deletedById: by ?? null,
            deletedByName: actor ? actor.name || actor.email : null,
        },
    });
    return row.id;
}
