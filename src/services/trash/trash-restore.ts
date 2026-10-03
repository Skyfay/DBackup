/**
 * A deleted record comes back under its own id, inside one transaction. What it linked to may be gone
 * by then: a link to a record that is not here any more is dropped, and the notes say what that changed.
 * A name someone took in the meantime stops the restore with a ConflictError, the person picks another.
 */

import { ConflictError } from "@/lib/logging/errors";
import type { Tx } from "@/lib/prisma-tx";
import type { ConnectionSnapshot, CredentialSnapshot, JobSnapshot, KeySnapshot, UserSnapshot } from "./trash-snapshot";
import type { TrashKind } from "./trash-types";

/** What a destination keeps while its retention policy is gone: every backup. */
const KEEP_EVERYTHING = JSON.stringify({ mode: "NONE" });

export interface RestoredRecord {
    name: string;
    notes: string[];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

async function restoreKey(tx: Tx, { record }: KeySnapshot, newName?: string): Promise<RestoredRecord> {
    const name = newName || record.name;
    if (await tx.encryptionProfile.findFirst({ where: { name }, select: { id: true } })) {
        throw new ConflictError(`A key named ${name} exists already. Two keys need two names.`);
    }
    await tx.encryptionProfile.create({ data: { ...record, name } });
    return { name, notes: [] };
}

async function restoreCredential(tx: Tx, { record }: CredentialSnapshot, newName?: string): Promise<RestoredRecord> {
    const name = newName || record.name;
    if (await tx.credentialProfile.findUnique({ where: { name }, select: { id: true } })) {
        throw new ConflictError(`A saved login named ${name} exists already.`);
    }
    await tx.credentialProfile.create({ data: { ...record, name } });
    return { name, notes: [] };
}

async function restoreConnection(tx: Tx, snapshot: ConnectionSnapshot, newName?: string): Promise<RestoredRecord> {
    const record = { ...snapshot.record, name: newName || snapshot.record.name };
    if (await tx.adapterConfig.findFirst({ where: { name: record.name, type: record.type }, select: { id: true } })) {
        throw new ConflictError(`A connection named ${record.name} exists already.`);
    }
    const notes: string[] = [];
    const credentialGone = async (id: string | null) => !!id && !(await tx.credentialProfile.findUnique({ where: { id }, select: { id: true } }));
    if (await credentialGone(record.primaryCredentialId)) {
        record.primaryCredentialId = null;
        notes.push("Its saved login is gone, pick one again before it connects.");
    }
    if (await credentialGone(record.sshCredentialId)) {
        record.sshCredentialId = null;
        notes.push("Its SSH login is gone, pick one again before it connects.");
    }
    if (record.defaultRetentionPolicyId && !(await tx.retentionPolicy.findUnique({ where: { id: record.defaultRetentionPolicyId }, select: { id: true } }))) {
        record.defaultRetentionPolicyId = null;
    }
    await tx.adapterConfig.create({ data: record });
    for (const version of snapshot.versionHistory ?? []) await tx.dbVersionHistory.create({ data: version });
    return { name: record.name, notes };
}

async function restoreJob(tx: Tx, snapshot: JobSnapshot, newName?: string): Promise<RestoredRecord> {
    const job = { ...snapshot.record, name: newName || snapshot.record.name };
    if (await tx.job.findFirst({ where: { name: job.name }, select: { id: true } })) {
        throw new ConflictError(`A job named ${job.name} exists already.`);
    }
    const notes: string[] = [];
    const adapterHere = async (id: string) => !!(await tx.adapterConfig.findUnique({ where: { id }, select: { id: true } }));

    if (job.sourceId && !(await adapterHere(job.sourceId))) {
        job.sourceId = null;
        notes.push("It has no database to back up, its connection is gone.");
    }
    if (job.encryptionProfileId && !(await tx.encryptionProfile.findUnique({ where: { id: job.encryptionProfileId }, select: { id: true } }))) {
        job.encryptionProfileId = null;
        // Without its key the job would write its next backups unencrypted, so it waits.
        if (job.enabled) notes.push("It is paused, its encryption key is gone and it would back up unencrypted.");
        job.enabled = false;
    }
    if (job.namingTemplateId && !(await tx.namingTemplate.findUnique({ where: { id: job.namingTemplateId }, select: { id: true } }))) {
        job.namingTemplateId = null;
        notes.push("It uses the default file names, its naming template is gone.");
    }
    if (job.schedulePresetId && !(await tx.schedulePreset.findUnique({ where: { id: job.schedulePresetId }, select: { id: true } }))) {
        job.schedulePresetId = null;
        notes.push("It runs on its own schedule, its schedule preset is gone.");
    }
    await tx.job.create({ data: job });

    let destinationsGone = 0;
    let keptEverything = 0;
    for (const destination of snapshot.destinations) {
        if (!(await adapterHere(destination.configId))) {
            destinationsGone++;
            continue;
        }
        const row = { ...destination };
        if (row.retentionPolicyId && !(await tx.retentionPolicy.findUnique({ where: { id: row.retentionPolicyId }, select: { id: true } }))) {
            // Without its policy it would fall back to the default one, which may remove backups the old policy kept.
            row.retentionPolicyId = null;
            row.retention = KEEP_EVERYTHING;
            keptEverything++;
        }
        await tx.jobDestination.create({ data: row });
    }

    let foldersGone = 0;
    for (const { presetIds, ...source } of snapshot.sources) {
        if (!(await adapterHere(source.configId))) {
            foldersGone++;
            continue;
        }
        const presets = await tx.excludePatternPreset.findMany({ where: { id: { in: presetIds } }, select: { id: true } });
        await tx.jobSource.create({ data: { ...source, excludePatternPresets: { connect: presets } } });
    }

    for (const link of snapshot.templates) {
        if (await tx.notificationTemplate.findUnique({ where: { id: link.templateId }, select: { id: true } })) {
            await tx.jobNotificationTemplate.create({ data: link });
        }
    }
    const channels = await tx.adapterConfig.findMany({ where: { id: { in: snapshot.channelIds } }, select: { id: true } });
    if (channels.length > 0) await tx.job.update({ where: { id: job.id }, data: { notifications: { connect: channels } } });

    // Its runs in History point at it again.
    if (snapshot.executionIds.length > 0) {
        await tx.execution.updateMany({ where: { id: { in: snapshot.executionIds }, jobId: null }, data: { jobId: job.id } });
    }

    if (destinationsGone > 0) notes.push(`${plural(destinationsGone, "destination is", "destinations are")} left out, its connection is gone.`);
    if (foldersGone > 0) notes.push(`${plural(foldersGone, "folder source is", "folder sources are")} left out, its connection is gone.`);
    if (keptEverything > 0) notes.push(`${plural(keptEverything, "destination keeps", "destinations keep")} every backup until a retention policy is picked again, its policy is gone.`);
    return { name: job.name, notes };
}

async function restoreUser(tx: Tx, snapshot: UserSnapshot, newEmail?: string): Promise<RestoredRecord> {
    const email = newEmail || snapshot.record.email;
    if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
        throw new ConflictError(`An account with ${email} exists already. Restore this one with another email.`);
    }
    const notes: string[] = [];
    const record = { ...snapshot.record, email };
    if (record.groupId && !(await tx.group.findUnique({ where: { id: record.groupId }, select: { id: true } }))) {
        record.groupId = null;
        notes.push("Its group is gone, so it sees nothing until it gets one.");
    }
    await tx.user.create({ data: record });
    for (const account of snapshot.accounts) await tx.account.create({ data: account });
    if (snapshot.twoFactor) await tx.twoFactor.create({ data: snapshot.twoFactor });
    for (const passkey of snapshot.passkeys) await tx.passkey.create({ data: passkey });
    for (const apiKey of snapshot.apiKeys) await tx.apiKey.create({ data: apiKey });
    for (const preference of snapshot.preferences) await tx.userPreference.create({ data: preference });
    if (snapshot.avatar) {
        const { data, ...avatar } = snapshot.avatar;
        await tx.avatar.create({ data: { ...avatar, userId: record.id, data: Buffer.from(data, "base64") } });
    }
    return { name: record.name || email, notes };
}

/** Restores one deleted record from its snapshot. `newName` is a new email for a user. */
export async function restoreSnapshot(tx: Tx, kind: TrashKind, data: unknown, newName?: string): Promise<RestoredRecord> {
    switch (kind) {
        case "encryptionKey":
            return restoreKey(tx, data as KeySnapshot, newName);
        case "credential":
            return restoreCredential(tx, data as CredentialSnapshot, newName);
        case "connection":
            return restoreConnection(tx, data as ConnectionSnapshot, newName);
        case "job":
            return restoreJob(tx, data as JobSnapshot, newName);
        case "user":
            return restoreUser(tx, data as UserSnapshot, newName);
    }
}
