import prisma from "@/lib/prisma";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { encrypt, decrypt, getSecretStatus } from "@/lib/crypto";
import { logger } from "@/lib/logging/logger";
import { ConflictError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import {
    CREDENTIAL_SCHEMAS,
    SshKeyGenerateSchema,
    type CredentialType,
    type CredentialData,
    type CredentialProfileShape,
    parseCredentialData,
} from "@/lib/core/credentials";
import { generateSshKeyPair, readPublicKey, sshFingerprint } from "@/lib/transport/openssh-key";

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
 * Everything a client may learn about a stored payload without revealing it: which sensitive
 * fields are set, and the public half of an SSH key.
 *
 * Both come out of the same decrypt, which is why they are computed together. Returns an
 * empty object if the payload can't be decrypted or parsed.
 */
function describePayload(encryptedData: string): Partial<CredentialProfileShape> {
    try {
        return describeParsedPayload(JSON.parse(decrypt(encryptedData)));
    } catch {
        return {};
    }
}

/** Same as `describePayload`, for a payload that is already in hand. */
function describeParsedPayload(payload: unknown): Partial<CredentialProfileShape> {
    const publicKey = publicKeyOf(payload);
    return {
        secretStatus: getSecretStatus(payload),
        ...(publicKey ? { publicKey, fingerprint: sshFingerprint(publicKey) ?? undefined } : {}),
    };
}

function publicKeyOf(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const value = (payload as { publicKey?: unknown }).publicKey;
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Turns an `SSH_KEY` payload into one that carries real key material.
 *
 * A `generate` request is answered here rather than in the route, so a private key is created
 * in the same place it is encrypted and never travels to a browser. A pasted key gets its
 * public half derived instead, which is best effort: a passphrase-protected or unusual key
 * simply ends up without one, and everything else about the profile still works.
 */
async function resolveSshKeyMaterial(type: CredentialType, raw: unknown): Promise<unknown> {
    if (type !== "SSH_KEY" || !raw || typeof raw !== "object" || Array.isArray(raw)) return raw;

    const payload = { ...(raw as Record<string, unknown>) };
    const request = payload.generate;
    delete payload.generate;
    // Only ever set from key material this function knows about.
    delete payload.publicKey;

    if (request !== undefined) {
        const parsed = SshKeyGenerateSchema.safeParse(request);
        if (!parsed.success) {
            throw new ValidationError("Invalid SSH key generation request", {
                field: "generate",
                cause: parsed.error,
            });
        }
        const { keyType, comment, passphrase } = parsed.data;
        const key = await generateSshKeyPair(keyType, comment ?? "", passphrase);
        log.info("Generated SSH keypair", {
            keyType,
            fingerprint: key.fingerprint,
            encrypted: !!passphrase,
        });
        return {
            ...payload,
            authType: "privateKey",
            privateKey: key.privateKey,
            publicKey: key.publicKey,
            // The passphrase of the new key, never one left in the form from an earlier key.
            passphrase: passphrase || undefined,
        };
    }

    if (payload.authType === "privateKey" && typeof payload.privateKey === "string") {
        const passphrase =
            typeof payload.passphrase === "string" ? payload.passphrase : undefined;
        const derived = readPublicKey(payload.privateKey, passphrase);
        if (derived) payload.publicKey = derived.publicKey;
    }

    return payload;
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

    const payload = await resolveSshKeyMaterial(type, data);

    // Validate payload shape before storing
    let validated: CredentialData;
    try {
        validated = parseCredentialData(type, payload);
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
    return { ...sanitize(profile), ...describeParsedPayload(validated) };
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
    return profiles.map((p) => ({ ...sanitize(p), ...describePayload(p.data) }));
}

/**
 * Lists credential profiles with their usage: how many `AdapterConfig` rows reference each one
 * across both the primary and SSH slots, and which adapters those rows belong to. Loads it in
 * one query instead of one per profile.
 */
export async function listCredentialProfilesWithCounts(
    type?: CredentialType
): Promise<Array<CredentialProfileShape & { usageCount: number; usedBy: string[] }>> {
    const profiles = await prisma.credentialProfile.findMany({
        where: type ? { type } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
            primaryAdapters: { select: { adapterId: true } },
            sshAdapters: { select: { adapterId: true } },
        },
    });
    return profiles.map(({ primaryAdapters, sshAdapters, ...profile }) => {
        const users = [...primaryAdapters, ...sshAdapters];
        return {
            ...sanitize(profile),
            ...describePayload(profile.data),
            usageCount: users.length,
            // Each adapter once, so a picker can suggest the logins that connections of the
            // same kind already use.
            usedBy: [...new Set(users.map((user) => user.adapterId))].sort(),
        };
    });
}

/**
 * Returns a single credential profile (sanitized) or throws `NotFoundError`.
 */
export async function getCredentialProfile(id: string): Promise<CredentialProfileShape> {
    const profile = await prisma.credentialProfile.findUnique({ where: { id } });
    if (!profile) {
        throw new NotFoundError("CredentialProfile", id);
    }
    return { ...sanitize(profile), ...describePayload(profile.data) };
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

    let stored: CredentialData | undefined;

    if (updates.data !== undefined) {
        const type = existing.type as CredentialType;
        const payload = await resolveSshKeyMaterial(type, updates.data);
        try {
            stored = parseCredentialData(type, payload);
        } catch (e) {
            throw new ValidationError("Credential payload validation failed", {
                cause: e instanceof Error ? e : undefined,
            });
        }
        patch.data = encrypt(JSON.stringify(stored));
    }

    if (updates.description !== undefined) {
        patch.description = updates.description;
    }

    const updated = await prisma.credentialProfile.update({
        where: { id },
        data: patch,
    });

    log.info("Credential profile updated", { id, fields: Object.keys(patch) });
    return {
        ...sanitize(updated),
        ...(stored ? describeParsedPayload(stored) : describePayload(updated.data)),
    };
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

/**
 * Deletes several credential profiles, reporting per-profile outcomes.
 *
 * Each goes through the single-profile guard, so one still attached to an adapter is
 * refused with its reference count while the rest of the batch continues.
 */
export async function deleteCredentialProfiles(ids: string[]): Promise<BulkResult> {
    const profiles = await prisma.credentialProfile.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
    });
    const names = new Map(profiles.map((profile) => [profile.id, profile.name]));

    return runBulk(ids, (id) => deleteCredentialProfile(id), (id) => names.get(id));
}
