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
import { sharedKindOf, type SharedKind } from "@/services/sharing/provided";
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
 * a SharedServer, unless they are back already. Those of a customer deleted meanwhile come back
 * ended, so the backups of its time stay with nobody, like after the delete of a tenant.
 */
async function restoreOldAssignments(tx: Tx, snapshot: ConnectionSnapshot, record: ConnectionSnapshot["record"], now = new Date()): Promise<void> {
    const assignments = snapshot.assignments ?? [];
    const rules = snapshot.assignmentRules ?? [];
    if (assignments.length === 0 && rules.length === 0) return;
    await rememberServer(tx, record);
    const customerGone = async (tenantId: string | null) => !!tenantId && !(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }));
    for (const assignment of assignments) {
        if (await tx.databaseAssignment.findUnique({ where: { id: assignment.id }, select: { id: true } })) continue;
        const validUntil = assignment.validUntil ?? ((await customerGone(assignment.tenantId)) ? now : null);
        await tx.databaseAssignment.create({ data: { ...assignment, validUntil } });
    }
    for (const rule of rules) {
        if (await tx.databaseAssignmentRule.findUnique({ where: { id: rule.id }, select: { id: true } })) continue;
        const validUntil = rule.validUntil ?? ((await customerGone(rule.tenantId)) ? now : null);
        await tx.databaseAssignmentRule.create({ data: { ...rule, validUntil } });
    }
}

/**
 * The connections among `ids` that other tenants share with `tenantId`, with their kind and whether
 * a destination takes only encrypted backups. It asks what `providedTo` in `provided.ts` asks, but
 * through the transaction: the client outside it would wait for the one connection to SQLite, which
 * the transaction holds until it ends.
 */
async function providedThrough(tx: Tx, tenantId: string, ids: string[]): Promise<Map<string, { kind: SharedKind; encryptedOnly: boolean }>> {
    if (ids.length === 0) return new Map();
    return runAsSystem(async () => {
        const rows = await tx.adapterConfig.findMany({
            where: {
                id: { in: ids },
                tenantId: { not: tenantId },
                share: { is: { OR: [{ allTenants: true }, { tenants: { some: { tenantId } } }] } },
            },
            select: { id: true, type: true, storageRole: true, tenantId: true, share: { select: { encryptedOnly: true } } },
        });
        if (rows.length === 0) return new Map();
        const providers = await tx.tenant.findMany({
            where: { id: { in: [...new Set(rows.map((row) => row.tenantId))] }, sharesWithCustomers: true },
            select: { id: true },
        });
        const sharing = new Set(providers.map((provider) => provider.id));
        return new Map(rows.flatMap((row) => {
            const kind = sharedKindOf(row);
            return kind && row.share && sharing.has(row.tenantId) ? [[row.id, { kind, encryptedOnly: row.share.encryptedOnly }] as const] : [];
        }));
    });
}

async function restoreJob(tx: Tx, snapshot: JobSnapshot, newName?: string): Promise<RestoredRecord> {
    const job = { ...snapshot.record, name: newName || snapshot.record.name };
    if (await tx.job.findFirst({ where: { name: job.name }, select: { id: true } })) {
        throw new ConflictError(`A job named ${job.name} exists already.`);
    }
    const notes: string[] = [];
    const adapterHere = async (id: string) => !!(await tx.adapterConfig.findUnique({ where: { id }, select: { id: true } }));
    // A destination or channel another tenant shares with the job's tenant is no row of it, and still
    // there while it is shared. A snapshot of a version before tenants names no tenant and nothing shared.
    const tenantId = (job as { tenantId?: string }).tenantId;
    const provided = tenantId
        ? await providedThrough(tx, tenantId, [...snapshot.destinations.map((destination) => destination.configId), ...snapshot.channelIds])
        : new Map<string, { kind: SharedKind; encryptedOnly: boolean }>();
    const providedAs = (id: string, kind: SharedKind) => {
        const connection = provided.get(id);
        return connection?.kind === kind ? connection : null;
    };

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
    let needKey = 0;
    let keptEverything = 0;
    for (const destination of snapshot.destinations) {
        const shared = providedAs(destination.configId, "destination");
        if (!shared && !(await adapterHere(destination.configId))) {
            destinationsGone++;
            continue;
        }
        // Like a save of the job, a destination that takes only encrypted backups wants a key.
        if (shared?.encryptedOnly && !job.encryptionProfileId) {
            needKey++;
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
    const own = new Set((await tx.adapterConfig.findMany({ where: { id: { in: snapshot.channelIds } }, select: { id: true } })).map((channel) => channel.id));
    const channels = snapshot.channelIds.filter((id) => own.has(id) || providedAs(id, "channel")).map((id) => ({ id }));
    if (channels.length > 0) await tx.job.update({ where: { id: job.id }, data: { notifications: { connect: channels } } });

    // Its runs in History point at it again.
    if (snapshot.executionIds.length > 0) {
        await tx.execution.updateMany({ where: { id: { in: snapshot.executionIds }, jobId: null }, data: { jobId: job.id } });
    }

    if (destinationsGone > 0) notes.push(`${plural(destinationsGone, "destination is", "destinations are")} left out, its connection is gone.`);
    if (needKey > 0) notes.push(needKey === 1
        ? "1 destination is left out, it takes only encrypted backups and the job has no key."
        : `${needKey} destinations are left out, they take only encrypted backups and the job has no key.`);
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
    // A platform group deleted since does not come back with it.
    if (record.platformGroupId && !(await tx.platformGroup.findUnique({ where: { id: record.platformGroupId }, select: { id: true } }))) {
        record.platformGroupId = null;
        notes.push("Its platform group was deleted since, so it comes back without one.");
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
    // Its keys go back into the tenants they were made in, the home tenant for an earlier version. A
    // key that comes back is one more of the tenant, which the platform may not let it make, like
    // `assertMayAddKind` asks for a new one.
    const keysRefused = new Map<string, number>();
    for (const apiKey of snapshot.apiKeys) {
        const tenantId = (apiKey as { tenantId?: string }).tenantId ?? HOME_TENANT_ID;
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, addsApiKeys: true } });
        if (!tenant) continue;
        if (!tenant.addsApiKeys) {
            keysRefused.set(tenant.name, (keysRefused.get(tenant.name) ?? 0) + 1);
            continue;
        }
        await runAsSystem(() => tx.apiKey.create({ data: { ...apiKey, tenantId } }));
    }
    for (const [tenant, count] of keysRefused) {
        notes.push(`${plural(count, "API key is", "API keys are")} left out, ${tenant} makes no API keys.`);
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
