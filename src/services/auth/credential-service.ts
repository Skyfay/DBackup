import prisma from "@/lib/prisma";
import { encrypt, decrypt, getSecretStatus } from "@/lib/crypto";
import { logger } from "@/lib/logging/logger";
import { ConflictError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import {
    CREDENTIAL_SCHEMAS,
    type CredentialType,
    type CredentialData,
    type CredentialProfileShape,
    parseCredentialData,
} from "@/lib/core/credentials";

const log = logger.child({ service: "CredentialService" });

/**
 * Sanitizes a Prisma `CredentialProfile` row by stripping the encrypted `data`
 * field. Used for any list/get response that should never expose secrets.
 */
function sanitize(profile: {
    id: string;
    name: string;
    type: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
}): CredentialProfileShape {
    return {
        id: profile.id,
        name: profile.name,
        type: profile.type as CredentialType,
        description: profile.description,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
    };
}

/**
 * Computes which sensitive payload fields are set, WITHOUT exposing values.
 * Used so the UI can tell whether an OAUTH profile is authorized (has a
 * refreshToken). Returns undefined if the payload can't be decrypted/parsed.
 */
function secretStatusOf(encryptedData: string): Record<string, boolean> | undefined {
    try {
        return getSecretStatus(JSON.parse(decrypt(encryptedData)));
    } catch {
        return undefined;
    }
}

/**
 * Creates a new credential profile.
 * Validates the payload against the type-specific schema before encrypting.
 */
export async function createCredentialProfile(
    name: string,
    type: CredentialType,
    data: unknown,
    description?: string
): Promise<CredentialProfileShape> {
    if (!CREDENTIAL_SCHEMAS[type]) {
        throw new ValidationError(`Unknown credential type: ${type}`, { field: "type" });
    }

    // Validate payload shape before storing
    let validated: CredentialData;
    try {
        validated = parseCredentialData(type, data);
    } catch (e) {
        throw new ValidationError("Credential payload validation failed", {
            cause: e instanceof Error ? e : undefined,
        });
    }

    // Enforce unique name (matches Prisma `@unique` but provides better error)
    const existing = await prisma.credentialProfile.findFirst({ where: { name } });
    if (existing) {
        throw new ConflictError(`A credential profile with the name "${name}" already exists.`);
    }

    const encryptedData = encrypt(JSON.stringify(validated));

    const profile = await prisma.credentialProfile.create({
        data: {
            name,
            type,
            data: encryptedData,
            description: description ?? null,
        },
    });

    log.info("Credential profile created", { id: profile.id, type, name });
    return sanitize(profile);
}

/**
 * Lists credential profiles, optionally filtered by type.
 * Returns sanitized records (no `data` payload).
 */
export async function listCredentialProfiles(
    type?: CredentialType
): Promise<CredentialProfileShape[]> {
    const profiles = await prisma.credentialProfile.findMany({
        where: type ? { type } : undefined,
        orderBy: { createdAt: "desc" },
    });
    return profiles.map((p) => ({ ...sanitize(p), secretStatus: secretStatusOf(p.data) }));
}

/**
 * Lists credential profiles with pre-computed usage counts.
 * Avoids the N+1 pattern of fetching counts individually per profile.
 */
export async function listCredentialProfilesWithCounts(
    type?: CredentialType
): Promise<Array<CredentialProfileShape & { usageCount: number }>> {
    const profiles = await prisma.credentialProfile.findMany({
        where: type ? { type } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
            _count: {
                select: { primaryAdapters: true, sshAdapters: true },
            },
        },
    });
    return profiles.map((p) => ({
        ...sanitize(p),
        secretStatus: secretStatusOf(p.data),
        usageCount: p._count.primaryAdapters + p._count.sshAdapters,
    }));
}

/**
 * Returns a single credential profile (sanitized) or throws `NotFoundError`.
 */
export async function getCredentialProfile(id: string): Promise<CredentialProfileShape> {
    const profile = await prisma.credentialProfile.findUnique({ where: { id } });
    if (!profile) {
        throw new NotFoundError("CredentialProfile", id);
    }
    return { ...sanitize(profile), secretStatus: secretStatusOf(profile.data) };
}

/**
 * Returns the decrypted credential payload.
 *
 * Pass `expectedType` to guard against type mismatches at the call site
 * (e.g. the config resolver knows which type it needs). The check is done
 * in the same DB round-trip, so there is no extra query cost.
 *
 * SECURITY: This function exposes plaintext secrets. Only call from:
 * - The runner / restore pipeline (via `resolveAdapterConfig`)
 * - The reveal API endpoint (gated behind `CREDENTIALS.REVEAL` permission)
 */
export async function getDecryptedCredentialData(
    id: string,
    expectedType?: CredentialType
): Promise<CredentialData> {
    const profile = await prisma.credentialProfile.findUnique({ where: { id } });
    if (!profile) {
        throw new NotFoundError("CredentialProfile", id);
    }

    if (expectedType && profile.type !== expectedType) {
        throw new ValidationError(
            `Credential type mismatch: expected ${expectedType}, got ${profile.type}`,
            { field: "type" }
        );
    }

    let parsed: unknown;
    try {
        const plaintext = decrypt(profile.data);
        parsed = JSON.parse(plaintext);
    } catch (e) {
        log.error("Failed to decrypt credential payload", { id }, wrapError(e));
        throw wrapError(e);
    }

    return parseCredentialData(profile.type as CredentialType, parsed);
}

/**
 * Updates a credential profile. Any provided field is updated;
 * `data` is re-validated against the existing type and re-encrypted.
 * Type itself cannot be changed (would invalidate referenced adapters).
 */
export async function updateCredentialProfile(
    id: string,
    updates: { name?: string; data?: unknown; description?: string | null }
): Promise<CredentialProfileShape> {
    const existing = await prisma.credentialProfile.findUnique({ where: { id } });
    if (!existing) {
        throw new NotFoundError("CredentialProfile", id);
    }

    const patch: { name?: string; data?: string; description?: string | null } = {};

    if (updates.name !== undefined && updates.name !== existing.name) {
        const conflict = await prisma.credentialProfile.findFirst({
            where: { name: updates.name, NOT: { id } },
        });
        if (conflict) {
            throw new ConflictError(
                `A credential profile with the name "${updates.name}" already exists.`
            );
        }
        patch.name = updates.name;
    }

    if (updates.data !== undefined) {
        let validated: CredentialData;
        try {
            validated = parseCredentialData(existing.type as CredentialType, updates.data);
        } catch (e) {
            throw new ValidationError("Credential payload validation failed", {
                cause: e instanceof Error ? e : undefined,
            });
        }
        patch.data = encrypt(JSON.stringify(validated));
    }

    if (updates.description !== undefined) {
        patch.description = updates.description;
    }

    const updated = await prisma.credentialProfile.update({
        where: { id },
        data: patch,
    });

    log.info("Credential profile updated", { id, fields: Object.keys(patch) });
    return sanitize(updated);
}

/**
 * Counts how many `AdapterConfig` rows reference this credential profile
 * across both the primary and SSH slots.
 */
export async function getReferenceCount(id: string): Promise<number> {
    const [primary, ssh] = await Promise.all([
        prisma.adapterConfig.count({ where: { primaryCredentialId: id } }),
        prisma.adapterConfig.count({ where: { sshCredentialId: id } }),
    ]);
    return primary + ssh;
}

/**
 * Returns the `AdapterConfig` rows that reference this credential profile,
 * tagged with which slot uses it.
 */
export async function getCredentialUsage(
    id: string
): Promise<Array<{ adapterId: string; name: string; type: string; slot: "primary" | "ssh" }>> {
    const profile = await prisma.credentialProfile.findUnique({ where: { id } });
    if (!profile) {
        throw new NotFoundError("CredentialProfile", id);
    }

    const [primary, ssh] = await Promise.all([
        prisma.adapterConfig.findMany({
            where: { primaryCredentialId: id },
            select: { id: true, name: true, adapterId: true },
        }),
        prisma.adapterConfig.findMany({
            where: { sshCredentialId: id },
            select: { id: true, name: true, adapterId: true },
        }),
    ]);

    return [
        ...primary.map((a) => ({
            adapterId: a.id,
            name: a.name,
            type: a.adapterId,
            slot: "primary" as const,
        })),
        ...ssh.map((a) => ({
            adapterId: a.id,
            name: a.name,
            type: a.adapterId,
            slot: "ssh" as const,
        })),
    ];
}

/**
 * Deletes a credential profile.
 * Throws `ConflictError` if any adapter still references it (primary or SSH slot).
 */
export async function deleteCredentialProfile(id: string): Promise<void> {
    const existing = await prisma.credentialProfile.findUnique({ where: { id } });
    if (!existing) {
        throw new NotFoundError("CredentialProfile", id);
    }

    const refs = await getReferenceCount(id);
    if (refs > 0) {
        throw new ConflictError(
            `Credential profile is still referenced by ${refs} adapter(s). Detach it first.`,
            { context: { id, references: refs } }
        );
    }

    await prisma.credentialProfile.delete({ where: { id } });
    log.info("Credential profile deleted", { id });
}
