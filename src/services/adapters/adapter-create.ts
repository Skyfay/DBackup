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
import { validateCredentialAssignments } from "@/lib/adapters/credential-validation";
import { validateStorageRole } from "@/lib/adapters/role-validation";
import { validateSnapshotConfig } from "@/lib/adapters/snapshot-validation";

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
 *   adapter cannot take or a snapshot the server cannot deliver.
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

    registerAdapters();
    await validateCredentialAssignments(adapterId, primaryCredentialId, sshCredentialId);

    // An adapter that only works one way round never gets a config pointing the other way,
    // whatever the request asked for.
    const role = isStorageRole(storageRole) ? storageRole : STORAGE_ROLES.DESTINATION;
    if (type === "storage") validateStorageRole(adapterId, role);

    const configObject = typeof config === "string" ? JSON.parse(config) : config;
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
