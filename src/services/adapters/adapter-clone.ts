/**
 * Copying a connection: same server, same logins, a new name and, for storage, the same role
 * or its counterpart.
 */

import type { AdapterConfig } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isStorageRole } from "@/lib/core/storage-roles";
import { registerAdapters } from "@/lib/adapters";
import { validateStorageRole } from "@/lib/adapters/role-validation";
import { decryptConfig } from "@/lib/crypto";
import { ValidationError } from "@/lib/logging/errors";
import { isShared } from "@/services/sharing/destination-access";
import { assertMayAdd } from "@/services/tenant/tenant-allowances";
import { assertMayReachHost } from "./adapter-create";

registerAdapters();

export interface CloneAdapterInput {
    /** The name of the copy. Without one it becomes "X (Copy)", then "X (Copy 2)" and so on. */
    name?: string;
    /** Storage only. Without one the copy keeps the role of the original. */
    role?: unknown;
}

export interface AdapterCloneResult {
    clone: AdapterConfig;
    original: { id: string; name: string };
}

/**
 * Creates a copy of a connection. Null when the original does not exist.
 *
 * @throws ValidationError for an unknown role, a role the adapter cannot serve, a destination
 *   shared with other tenants, a kind the tenant may not add or a connection that reaches the
 *   server DBackup runs on outside the platform.
 */
export async function cloneAdapter(id: string, input: CloneAdapterInput): Promise<AdapterCloneResult | null> {
    const original = await prisma.adapterConfig.findUnique({ where: { id } });
    if (!original) return null;

    const name = input.name && input.name.trim() ? input.name.trim() : await freeCopyName(original.name, original.type);

    // Without a role the copy keeps the original's, so a copied directory source never comes
    // back as a destination. With one, this is the counterpart action: same server, opposite role.
    if (input.role !== undefined && !isStorageRole(input.role)) {
        throw new ValidationError("Invalid storage role", { field: "role" });
    }
    const storageRole = isStorageRole(input.role) ? input.role : original.storageRole;

    // The write path that exists precisely to flip a role, so without this check it would be
    // the way around an adapter that only supports one.
    if (original.type === "storage" && isStorageRole(storageRole)) {
        validateStorageRole(original.adapterId, storageRole);
    }
    // A copy of a destination shared with other tenants is one nobody shares, which shows its
    // tenant the folders of the customers that the shared one hides.
    if (original.type === "storage" && (await isShared(original.id))) {
        throw new ValidationError("It is shared with other tenants, so it is not copied. Stop sharing it first.");
    }
    // A copy is a new connection, which the platform may not let the tenant add itself.
    await assertMayAdd(original.type, storageRole);
    // Nor one that reaches the server DBackup runs on, wherever the original came from.
    await assertMayReachHost(original.adapterId, () => decryptConfig(JSON.parse(original.config)) as Record<string, unknown>, {
        primaryCredentialId: original.primaryCredentialId,
        sshCredentialId: original.sshCredentialId,
    });

    const clone = await prisma.adapterConfig.create({
        data: {
            name,
            type: original.type,
            adapterId: original.adapterId,
            storageRole,
            // The encrypted config is copied as it is, it needs no decrypting.
            config: original.config,
            primaryCredentialId: original.primaryCredentialId ?? null,
            sshCredentialId: original.sshCredentialId ?? null,
            ...(original.metadata ? { metadata: original.metadata } : {}),
            // The health fields are left out, the copy starts fresh.
        },
    });

    return { clone, original: { id: original.id, name: original.name } };
}

/** The first of "X (Copy)", "X (Copy 2)", ... no connection of the type has yet. */
async function freeCopyName(name: string, type: string): Promise<string> {
    let candidate = `${name} (Copy)`;
    let counter = 2;
    while (await prisma.adapterConfig.findFirst({ where: { name: candidate, type } })) {
        candidate = `${name} (Copy ${counter})`;
        counter++;
    }
    return candidate;
}
