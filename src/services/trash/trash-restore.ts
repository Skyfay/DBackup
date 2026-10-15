/**
 * A deleted record comes back under its own id, inside one transaction. What it linked to may be gone
 * by then: a link to a record that is not here any more is dropped, and the notes say what that changed.
 * A name someone took in the meantime stops the restore with a ConflictError, the person picks another.
 */

import { ConflictError } from "@/lib/logging/errors";
import type { Tx } from "@/lib/prisma-tx";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { rememberServer, serverRestored } from "@/services/tenant/shared-servers";
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
    if (await tx.credentialProfile.findFirst({ where: { name }, select: { id: true } })) {
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
    // The assignments of its databases waited for it, and its customers restore again.
    await serverRestored(tx, record.id);
    await restoreOldAssignments(tx, snapshot, record);
    return { name: record.name, notes };
}

/**
 * A snapshot of an earlier version holds the assignments the delete took along. They come back under
 * a SharedServer, unless they are back already. A customer deleted meanwhile takes its databases along.
 */
async function restoreOldAssignments(tx: Tx, snapshot: ConnectionSnapshot, record: ConnectionSnapshot["record"]): Promise<void> {
    const assignments = snapshot.assignments ?? [];
    const rules = snapshot.assignmentRules ?? [];
    if (assignments.length === 0 && rules.length === 0) return;
    await rememberServer(tx, record);
    const customerHere = async (tenantId: string) => !!(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }));
    for (const assignment of assignments) {
        if (!(await customerHere(assignment.tenantId))) continue;
        if (!(await tx.databaseAssignment.findUnique({ where: { id: assignment.id }, select: { id: true } }))) await tx.databaseAssignment.create({ data: assignment });
    }
    for (const rule of rules) {
        if (!(await customerHere(rule.tenantId))) continue;
        if (!(await tx.databaseAssignmentRule.findUnique({ where: { id: rule.id }, select: { id: true } }))) await tx.databaseAssignmentRule.create({ data: rule });
    }
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
    const { groupId: legacyGroupId, ...record } = { ...snapshot.record, email };
    // A snapshot of an earlier version knows one group, in the only tenant there was. Its
    // SuperAdmin group holds every permission now, and its members are platform admins, like the
    // migration made them.
    const memberships = snapshot.memberships ?? (legacyGroupId ? [{ tenantId: HOME_TENANT_ID, groupId: legacyGroupId }] : []);
    if (!snapshot.memberships && legacyGroupId && (await runAsTenant(HOME_TENANT_ID, () => tx.group.findUnique({ where: { id: legacyGroupId }, select: { fullAccess: true } })))?.fullAccess) {
        record.platformRole = PLATFORM_ADMIN_ROLE;
    }
    await tx.user.create({ data: record });
    let lost = 0;
    for (const membership of memberships) {
        // The group has to be one of the membership's tenant, looked up there.
        const [group, tenant] = await Promise.all([
            runAsTenant(membership.tenantId, () => tx.group.findUnique({ where: { id: membership.groupId }, select: { id: true } })),
            tx.tenant.findUnique({ where: { id: membership.tenantId }, select: { id: true } }),
        ]);
        if (group && tenant) await tx.tenantMembership.create({ data: { userId: record.id, ...membership } });
        else lost++;
    }
    if (lost > 0) notes.push(lost === memberships.length ? "Its group is gone, so it sees nothing until it gets one." : `${plural(lost, "of its groups is", "of its groups are")} gone.`);
    for (const account of snapshot.accounts) await tx.account.create({ data: account });
    if (snapshot.twoFactor) await tx.twoFactor.create({ data: snapshot.twoFactor });
    for (const passkey of snapshot.passkeys) await tx.passkey.create({ data: passkey });
    // Its keys go back into the tenants they were made in, the home tenant for an earlier version.
    for (const apiKey of snapshot.apiKeys) {
        const tenantId = (apiKey as { tenantId?: string }).tenantId ?? HOME_TENANT_ID;
        if (await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })) {
            await runAsSystem(() => tx.apiKey.create({ data: { ...apiKey, tenantId } }));
        }
    }
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
