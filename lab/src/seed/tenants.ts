/**
 * The customers of the lab beside the home tenant, see ../tenants.ts for what they are. Each part
 * is found by its name or email and only added when it is missing, so a second run changes
 * nothing and a tenant of that name made by hand keeps its settings. Runs after the home tenant is
 * seeded, since Acme gets its connections.
 */

import { isIP } from "net";
import prisma from "@/lib/prisma";
import { AVAILABLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { runAsTenant } from "@/lib/tenant/context";
import { createEncryptionProfile } from "@/services/backup/encryption-service";
import { createNotificationTemplate } from "@/services/templates/notification-template-service";
import { jobService } from "@/services/jobs/job-service";
import { recipientsOf, setRecipients } from "@/services/sharing/channel-recipients";
import { connectionShareService } from "@/services/sharing/connection-shares";
import { databaseAssignmentService } from "@/services/tenant/database-assignments";
import { membershipService } from "@/services/tenant/membership-service";
import { networkOfRow, setNetwork, type TenantNetwork } from "@/services/tenant/tenant-network";
import { tenantService } from "@/services/tenant/tenant-service";
import { platformGroupService } from "@/services/user/platform-group-service";
import { userService } from "@/services/user/user-service";
import { DATABASES } from "../catalog";
import type { LabConfig } from "../config";
import { engineOf } from "../engines";
import { ACME_DATABASE, ACME_SERVER, LAB_SUPPORT, LAB_TENANTS, SHARED_WITH_ACME } from "../tenants";
import type { SeededConnections } from "./connections";
import { ensureConnection, ensureCredential } from "./records";

type Log = string[];

/** The tenant by its name, made with its network when it is missing. One made by hand keeps the network it has. */
async function ensureTenant(name: string, network: TenantNetwork, log: Log): Promise<string> {
    const existing = await prisma.tenant.findUnique({ where: { name }, select: { id: true } });
    if (existing) return existing.id;
    const created = await tenantService.create(name);
    log.push(`created tenant ${name}`);
    await ensureNetwork(created.id, name, network, log);
    return created.id;
}

/** The person of a tenant with its Admin group there, made like New user makes one. */
async function ensurePerson(tenantId: string, person: { name: string; email: string }, password: string, log: Log): Promise<void> {
    const adminGroup = await runAsTenant(tenantId, () => prisma.group.findFirst({ where: { fullAccess: true }, select: { id: true } }));
    if (!adminGroup) throw new Error(`The tenant ${tenantId} has no Admin group`);
    const user = await prisma.user.findUnique({ where: { email: person.email }, select: { id: true } });
    if (!user) {
        await userService.createUser({ ...person, password, groupId: adminGroup.id, tenantId });
        log.push(`created user ${person.email}`);
        return;
    }
    if (!(await membershipService.isPersonOf(user.id, tenantId))) {
        await membershipService.setRole(user.id, tenantId, adminGroup.id, { platformAdmin: true });
        log.push(`added ${person.email} to its tenant again`);
    }
}

async function ensureNetwork(tenantId: string, name: string, wanted: TenantNetwork, log: Log): Promise<void> {
    const row = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { id: true, blocksLocalNetwork: true, allowedNetworks: true } });
    const now = networkOfRow(row);
    if (now.blocks === wanted.blocks && JSON.stringify(now.allowed) === JSON.stringify(wanted.allowed)) return;
    await setNetwork(tenantId, wanted);
    log.push(`${name} ${wanted.blocks ? "blocks" : "reaches"} the local network${wanted.allowed.length ? `, but for ${wanted.allowed.join(", ")}` : ""}`);
}

/** Acme reaches the lab through an allowed range, the address of the Docker host alone. A name instead of an address cannot be a range. */
function acmeNetwork(config: LabConfig): TenantNetwork {
    const address = config.docker.address;
    const family = isIP(address);
    if (family === 0) return { blocks: false, allowed: [] };
    return { blocks: true, allowed: [`${address}/${family === 4 ? 32 : 128}`] };
}

/** A platform group of Acme and Globex: their tenants and accounts on the platform, everything inside them. */
async function ensureSupport(tenantIds: string[], password: string, log: Log): Promise<void> {
    let group = await prisma.platformGroup.findFirst({ where: { name: LAB_SUPPORT.group }, select: { id: true } });
    if (!group) {
        group = await platformGroupService.create({
            name: LAB_SUPPORT.group,
            platformPermissions: [PERMISSIONS.PLATFORM.TENANTS_READ, PERMISSIONS.PLATFORM.TENANTS_WRITE, PERMISSIONS.PLATFORM.ACCOUNTS_READ, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE],
            // The service keeps the rights a group of a tenant can hold, never those of the platform or the instance.
            tenantPermissions: AVAILABLE_PERMISSIONS.map((permission) => permission.id),
            allTenants: false,
            tenantIds,
        });
        log.push(`created platform group ${LAB_SUPPORT.group} of ${Object.values(LAB_TENANTS).map((tenant) => tenant.name).join(" and ")}`);
    }
    const user = await prisma.user.findUnique({ where: { email: LAB_SUPPORT.person.email }, select: { id: true, platformGroupId: true } });
    if (!user) {
        await userService.createPlatformUser({ ...LAB_SUPPORT.person, password }, { kind: "group", id: group.id });
        log.push(`created user ${LAB_SUPPORT.person.email} in ${LAB_SUPPORT.group}`);
    } else if (user.platformGroupId !== group.id) {
        await platformGroupService.setFor(user.id, { kind: "group", id: group.id });
        log.push(`put ${LAB_SUPPORT.person.email} into ${LAB_SUPPORT.group} again`);
    }
}

/** Shares a connection of the home tenant with Acme too, keeping whoever else gets it. */
async function ensureShared(configId: string | undefined, name: string, acmeId: string, log: Log): Promise<boolean> {
    if (!configId) {
        log.push(`skipped sharing ${name}, it is not in this lab`);
        return false;
    }
    const share = await prisma.connectionShare.findUnique({ where: { id: configId }, include: { tenants: { select: { tenantId: true } } } });
    if (share && (share.allTenants || share.tenants.some((tenant) => tenant.tenantId === acmeId))) return true;
    await connectionShareService.save(configId, {
        allTenants: false,
        tenantIds: [...(share?.tenants.map((tenant) => tenant.tenantId) ?? []), acmeId],
        encryptedOnly: share?.encryptedOnly ?? false,
        ownRecipients: share?.ownRecipients ?? true,
    });
    log.push(`shared ${name} with ${LAB_TENANTS.acme.name}`);
    return true;
}

/** Acme's own server, a database service of the lab, with its login, a key of its Vault and a job to the shared destination. */
async function seedAcmeJob(config: LabConfig, destinationId: string | undefined, channelId: string | undefined, log: Log): Promise<void> {
    const database = DATABASES.find((entry) => entry.service === ACME_SERVER.service);
    if (!database || !destinationId) {
        log.push(`skipped job ${ACME_SERVER.job}, its server or destination is not in this lab`);
        return;
    }
    const spec = engineOf(database.engine);
    const login = await ensureCredential(ACME_SERVER.login, "USERNAME_PASSWORD", spec.login);
    const server = await ensureConnection({
        name: ACME_SERVER.connection,
        type: "database",
        adapterId: spec.id,
        config: spec.source({ host: config.docker.address, port: database.port }, config),
        primaryCredentialId: login,
    });
    if (server.created) log.push(`created database ${ACME_SERVER.connection} in ${LAB_TENANTS.acme.name}`);

    if (await prisma.job.findFirst({ where: { name: ACME_SERVER.job }, select: { id: true } })) return;
    const key = (await prisma.encryptionProfile.findFirst({ where: { name: ACME_SERVER.key }, select: { id: true } }))
        ?? await createEncryptionProfile(ACME_SERVER.key, "Created by the dev lab seed");
    // A job hears about its runs through a template, which may name a channel another tenant shares.
    const template = channelId
        ? (await prisma.notificationTemplate.findFirst({ where: { name: ACME_SERVER.alerts }, select: { id: true } }))
            ?? await createNotificationTemplate({ name: ACME_SERVER.alerts, description: "Created by the dev lab seed", channels: [{ configId: channelId, events: "SUCCESS|PARTIAL|FAILED" }] })
        : null;
    await jobService.createJob({
        name: ACME_SERVER.job,
        schedule: "0 2 * * *",
        enabled: false,
        sourceId: server.id,
        databases: [],
        destinations: [{ configId: destinationId, priority: 0, retention: JSON.stringify({ mode: "SIMPLE", simple: { keepCount: 7 } }), retentionPolicyId: null }],
        encryptionProfileId: key.id,
        compression: "GZIP",
        notificationTemplateIds: template ? [template.id] : [],
    });
    log.push(`created job ${ACME_SERVER.job} in ${LAB_TENANTS.acme.name}`);
}

/** Called in the home tenant, after its connections are seeded. */
export async function seedTenants(config: LabConfig, connections: SeededConnections): Promise<string[]> {
    const log: Log = [];
    const password = config.admin.password;
    const acmeId = await ensureTenant(LAB_TENANTS.acme.name, acmeNetwork(config), log);
    const globexId = await ensureTenant(LAB_TENANTS.globex.name, { blocks: true, allowed: [] }, log);

    await ensurePerson(acmeId, LAB_TENANTS.acme.person, password, log);
    await ensurePerson(globexId, LAB_TENANTS.globex.person, password, log);
    await ensureSupport([acmeId, globexId], password, log);

    // One database of a lab server of the home tenant, the other databases stay with it.
    const serverId = connections.sources.get(ACME_DATABASE.service);
    if (serverId) {
        const { changed } = await databaseAssignmentService.assign(serverId, [{ databaseName: ACME_DATABASE.database, tenantId: acmeId }], null);
        if (changed) log.push(`gave ${ACME_DATABASE.database} of ${ACME_DATABASE.service} to ${LAB_TENANTS.acme.name}`);
    } else {
        log.push(`skipped giving ${ACME_DATABASE.database} away, ${ACME_DATABASE.service} is not in this lab`);
    }

    const destinationId = connections.destinations.get("local");
    const channelId = connections.channels.get("mail");
    const destinationShared = await ensureShared(destinationId, SHARED_WITH_ACME.destination, acmeId, log);
    const channelShared = await ensureShared(channelId, SHARED_WITH_ACME.channel, acmeId, log);

    await runAsTenant(acmeId, async () => {
        if (channelShared && channelId) {
            // Only while Acme names nobody, so the addresses named by hand stay.
            const wanted = [LAB_TENANTS.acme.person.email];
            if ((await recipientsOf(channelId, acmeId)).length === 0) {
                await setRecipients(channelId, acmeId, wanted);
                log.push(`${LAB_TENANTS.acme.name} names ${wanted.join(", ")} for ${SHARED_WITH_ACME.channel}`);
            }
        }
        // An Acme made by hand may block the lab or add no databases, which refuses its server.
        await seedAcmeJob(config, destinationShared ? destinationId : undefined, channelShared ? channelId : undefined, log)
            .catch((error: unknown) => log.push(`skipped job ${ACME_SERVER.job}: ${error instanceof Error ? error.message : String(error)}`));
    });

    if (log.length === 0) log.push(`kept ${LAB_TENANTS.acme.name}, ${LAB_TENANTS.globex.name} and ${LAB_SUPPORT.group}`);
    return log;
}
