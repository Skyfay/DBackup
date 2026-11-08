/**
 * Creating a connection: a database source, a storage destination or source, or a notification
 * channel. The route and the dev lab seed both create connections, so every check lives here once.
 */

import type { AdapterConfig } from "@prisma/client";
import prisma from "@/lib/prisma";
import { encryptConfig } from "@/lib/crypto";
import { ConflictError, ValidationError } from "@/lib/logging/errors";
import { isStorageRole, STORAGE_ROLES } from "@/lib/core/storage-roles";
import { registerAdapters } from "@/lib/adapters";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { validateCredentialAssignments } from "@/lib/adapters/credential-validation";
import { validateStorageRole } from "@/lib/adapters/role-validation";
import { validateSnapshotConfig } from "@/lib/adapters/snapshot-validation";
import { layLoginsOver, mayReachHost } from "@/lib/adapters/config-resolver";
import { hostLocalReason } from "@/lib/adapters/host-local";
import { assertOffOwnData } from "@/lib/adapters/own-data";
import { assertConfigFitsSchema } from "@/lib/adapters/config-check";
import { withFreshSwitches } from "@/lib/adapters/later-switches";
import { currentTenantId } from "@/lib/tenant/current";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { assertMayAdd } from "@/services/tenant/tenant-allowances";
import { assertTenantReach } from "@/services/tenant/tenant-network";
import { assertOffSharedPlaces } from "./shared-place";

export interface CreateAdapterInput {
    name: string;
    type: string;
    adapterId: string;
    config: Record<string, unknown> | string;
    metadata?: Record<string, unknown> | null;
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
    /** Storage only. A destination unless it says SOURCE. */
    storageRole?: string | null;
}

const KIND_NAMES: Record<string, string> = { database: "source", storage: "destination", notification: "notification" };

/**
 * Checks and stores a new connection with its secrets encrypted.
 *
 * @throws ValidationError for a missing field, a credential profile of the wrong type, a role the
 *   adapter cannot take, a snapshot the server cannot deliver, a connection that reaches the
 *   server DBackup runs on outside the platform or the local network its tenant blocks, or storage
 *   that overlaps a destination the tenant shares with customers.
 * @throws NotFoundError for a credential profile that does not exist.
 * @throws ConflictError when a connection of the same type has the name already.
 */
export async function createAdapter(input: CreateAdapterInput): Promise<AdapterConfig> {
    const { name, type, adapterId, config, metadata, storageRole } = input;
    const primaryCredentialId = input.primaryCredentialId ?? null;
    const sshCredentialId = input.sshCredentialId ?? null;

    if (!name || !type || !adapterId || !config) {
        throw new ValidationError("Missing required fields");
    }
    // The caller checked the permission of the type, so the adapter must be one of that type.
    if (getAdapterDefinition(adapterId)?.type !== type) {
        throw new ValidationError("Unknown adapter for this kind of connection");
    }

    registerAdapters();
    await validateCredentialAssignments(adapterId, primaryCredentialId, sshCredentialId);

    // An adapter that only works one way round never gets a config pointing the other way,
    // whatever the request asked for.
    const role = isStorageRole(storageRole) ? storageRole : STORAGE_ROLES.DESTINATION;
    if (type === "storage") validateStorageRole(adapterId, role);
    // The platform decides whether the tenant adds connections of this kind itself.
    await assertMayAdd(type, role);

    // A switch that came after connections were saved without it gets the value of today, so only a
    // connection saved before it keeps the old behaviour, see `later-switches.ts`.
    const configObject = withFreshSwitches(adapterId, typeof config === "string" ? JSON.parse(config) : config);
    // The adapters take a stored config as it is, so it has to fit the schema of its adapter before
    // anything resolves or dials what it names, see `config-check.ts`.
    assertConfigFitsSchema(adapterId, configObject);
    // Before the snapshot check, which already logs in to the server the config names.
    await assertMayReachHost(adapterId, configObject, { primaryCredentialId, sshCredentialId });
    // Nor where a destination of the tenant shared with customers keeps their backups.
    if (type === "storage") await assertOffSharedPlaces(adapterId, configObject, { primaryCredentialId, sshCredentialId });
    // A snapshot-enabled config is only accepted when the server can actually deliver one, the
    // gate of the form alone could be bypassed.
    await validateSnapshotConfig(adapterId, configObject, role, primaryCredentialId, sshCredentialId);

    const existingByName = await prisma.adapterConfig.findFirst({ where: { name, type } });
    if (existingByName) {
        throw new ConflictError(`A ${KIND_NAMES[type] ?? type} with the name "${name}" already exists.`);
    }

    return prisma.adapterConfig.create({
        data: {
            name,
            type,
            adapterId,
            config: JSON.stringify(encryptConfig(configObject)),
            primaryCredentialId,
            sshCredentialId,
            ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
            // The role only makes sense for storage adapters, other types keep the default.
            ...(type === "storage" && isStorageRole(storageRole) ? { storageRole } : {}),
        },
    });
}

/** The credential profiles a config is used with, laid over it before it is checked. */
export interface HostCheckLogins {
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
}

/**
 * Refuses a connection that reaches the server DBackup runs on, see `hostLocalReason`, unless a
 * platform admin with a session adds it in the home tenant or code outside a request does, see
 * `mayReachHost`, one that reaches the own data of DBackup, unless a platform admin adds it, see
 * `own-data.ts`, and one whose hosts lie in the local network while its tenant blocks it, see
 * `tenant-network.ts`. Every path that saves a connection or runs one that is not saved yet, like a
 * connection test or a browse of its folders, checks it, since one run is enough to read the key of
 * every secret.
 *
 * The config may come as a function, for a caller that would decrypt it only for this check.
 *
 * @throws ValidationError saying what reaches the server or which host lies in the local network.
 */
export async function assertMayReachHost(
    adapterId: string,
    config: Record<string, unknown> | (() => Record<string, unknown>),
    logins: HostCheckLogins = {}
): Promise<void> {
    const tenantId = await currentTenantId();
    const plain = { ...(typeof config === "function" ? config() : config) };
    if (!tenantId || tenantId === HOME_TENANT_ID) {
        // The home tenant reaches the server through a platform admin alone, and its own data too.
        // A login that cannot be read fails the run anyway, so the config alone speaks for it then.
        await assertMayManageHostLocal(adapterId, plain, logins, true);
        // A local path takes no login, so the config is checked as it is.
        await assertOffOwnData(adapterId, plain);
        return;
    }

    // An SSH key profile decides how SSH logs in, through the agent of the server among others,
    // and a webhook profile holds the URL a channel posts to.
    const effective = await withLogins(adapterId, plain, logins, false);
    const reason = hostLocalReason(adapterId, effective);
    if (reason) throw new ValidationError(reason, { field: "config" });
    await assertTenantReach(tenantId, adapterId, effective);
}

/**
 * Refuses a connection that reaches the server DBackup runs on to anyone but a platform admin with a
 * session in the home tenant, see `mayReachHost`, whatever else the change does. An edit of such a
 * connection that only renames it asks it too, and so does a restore from Recently deleted.
 *
 * @param lenient Takes the config alone when a login it names cannot be read, like one that was
 *   deleted since the snapshot of Recently deleted was taken.
 * @throws ValidationError saying what reaches the server.
 */
export async function assertMayManageHostLocal(
    adapterId: string,
    config: Record<string, unknown>,
    logins?: HostCheckLogins,
    lenient = false
): Promise<void> {
    const effective = logins ? await withLogins(adapterId, { ...config }, logins, lenient) : config;
    const reason = hostLocalReason(adapterId, effective);
    if (reason && !(await mayReachHost())) throw new ValidationError(reason, { field: "config" });
}

/** A config with its credential profiles laid over it, as a run sees it. */
async function withLogins(adapterId: string, config: Record<string, unknown>, logins: HostCheckLogins, lenient: boolean): Promise<Record<string, unknown>> {
    const primary = logins.primaryCredentialId ?? null;
    const ssh = logins.sshCredentialId ?? null;
    if (!primary && !ssh) return config;
    try {
        return await layLoginsOver(adapterId, { ...config }, primary, ssh);
    } catch (error) {
        if (lenient) return config;
        throw error;
    }
}
