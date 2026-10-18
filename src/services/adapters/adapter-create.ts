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
import { layLoginsOver } from "@/lib/adapters/config-resolver";
import { hostLocalReason } from "@/lib/adapters/host-local";
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

    const configObject = typeof config === "string" ? JSON.parse(config) : config;
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
 * Refuses a connection that reaches the server DBackup runs on, see `hostLocalReason`, unless the
 * code runs for the home tenant or outside any tenant, like a script or the system scope, and one
 * whose hosts lie in the local network while its tenant blocks it, see `tenant-network.ts`. Every
 * path that saves a connection or runs one that is not saved yet, like a connection test or a
 * browse of its folders, checks it, since one run is enough to read the key of every secret.
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
    if (!tenantId || tenantId === HOME_TENANT_ID) return;

    const plain = { ...(typeof config === "function" ? config() : config) };
    const primary = logins.primaryCredentialId ?? null;
    const ssh = logins.sshCredentialId ?? null;
    // An SSH key profile decides how SSH logs in, through the agent of the server among others,
    // and a webhook profile holds the URL a channel posts to.
    const effective = primary || ssh ? await layLoginsOver(adapterId, plain, primary, ssh) : plain;
    const reason = hostLocalReason(adapterId, effective);
    if (reason) throw new ValidationError(reason, { field: "config" });
    await assertTenantReach(tenantId, adapterId, effective);
}
