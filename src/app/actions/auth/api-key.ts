"use server"

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, getCurrentUserWithGroup } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { apiKeyService } from "@/services/auth/api-key-service";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, NotFoundError } from "@/lib/logging/errors";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { groupPermissions } from "@/lib/auth/owner-permissions";
import { areaChanges, knownPermissions, permissionPhrase } from "@/lib/auth/permission-areas";
import { listWords } from "@/lib/auth/access-summary";

const log = logger.child({ action: "api-key" });

// ============================================================================
// Validation Schemas
// ============================================================================

const KeyFieldsSchema = z.object({
  name: z.string().trim().min(1, "Give the key a name.").max(100, "The name can have at most 100 characters."),
  permissions: z.array(z.string().max(64)).max(100),
  /** When the key stops working, null for never. */
  expiresAt: z.string().datetime().nullable(),
});

const CreateApiKeySchema = KeyFieldsSchema.extend({
  /** The task of the first step of New API key, kept in the audit log. */
  template: z.string().max(40).optional(),
});

const IdSchema = z.string().min(1).max(200);

export type CreateApiKeyFormValues = z.input<typeof CreateApiKeySchema>;
export type UpdateApiKeyFormValues = z.input<typeof KeyFieldsSchema>;

const NAME_TAKEN = "A key by this name exists already.";

/** The names of the permissions beyond what may be given, for the refusal. */
function beyond(requested: string[], allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  return requested.filter((permission) => !allowedSet.has(permission)).map(permissionPhrase);
}

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Creates an API key owned by the caller. It never gets more than the group of the caller may do,
 * and it is checked against that group at every request too. Returns the key once.
 */
export async function createApiKey(data: CreateApiKeyFormValues) {
  await checkPermission(PERMISSIONS.API_KEYS.WRITE);
  const currentUser = await getCurrentUserWithGroup();
  if (!currentUser) {
    return { success: false, error: "Not authenticated" };
  }

  const parsed = CreateApiKeySchema.safeParse(data);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const permissions = knownPermissions(parsed.data.permissions);
  if (permissions.length === 0) return { success: false, error: "Give the key at least one permission." };
  const refused = beyond(permissions, groupPermissions(currentUser.group));
  if (refused.length > 0) {
    return { success: false, error: `Your group may not ${listWords(refused)}, so no key of yours may.` };
  }

  try {
    if (await apiKeyService.nameTaken(parsed.data.name)) return { success: false, error: NAME_TAKEN };
    const result = await apiKeyService.create({
      name: parsed.data.name,
      permissions,
      userId: currentUser.id,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    });

    revalidatePath("/dashboard/users");

    await auditService.log(
      currentUser.id,
      AUDIT_ACTIONS.CREATE,
      AUDIT_RESOURCES.API_KEY,
      {
        apiKeyId: result.apiKey.id,
        name: parsed.data.name,
        permissions,
        expiresAt: parsed.data.expiresAt,
        ...(parsed.data.template ? { template: parsed.data.template } : {}),
      },
      result.apiKey.id
    );

    return {
      success: true,
      data: {
        apiKey: result.apiKey,
        rawKey: result.rawKey,
      },
    };
  } catch (error) {
    log.error("Failed to create API key", {}, wrapError(error));
    return { success: false, error: getErrorMessage(error) || "Failed to create API key" };
  }
}

/**
 * Changes the name, the permissions and the end of a key. A permission it gets new is never more
 * than the group of its owner may do, nor more than the caller may do themselves.
 */
export async function updateApiKey(id: string, data: UpdateApiKeyFormValues) {
  await checkPermission(PERMISSIONS.API_KEYS.WRITE);
  const keyId = IdSchema.safeParse(id);
  const parsed = KeyFieldsSchema.safeParse(data);
  if (!keyId.success || !parsed.success) return { success: false, error: parsed.error?.issues[0]?.message ?? "Invalid request" };
  const currentUser = await getCurrentUserWithGroup();
  if (!currentUser) return { success: false, error: "Not authenticated" };

  const permissions = knownPermissions(parsed.data.permissions);
  if (permissions.length === 0) return { success: false, error: "Give the key at least one permission." };

  try {
    if (await apiKeyService.nameTaken(parsed.data.name, keyId.data)) return { success: false, error: NAME_TAKEN };
    // Only what the key gets new is checked. What it keeps, even paused, stays as it was.
    const owner = await apiKeyService.ownerOf(keyId.data);
    const stored = new Set(owner.permissions);
    const added = permissions.filter((permission) => !stored.has(permission));
    const beyondOwner = beyond(added, groupPermissions(owner.group));
    if (beyondOwner.length > 0) {
      return { success: false, error: `The group of its owner may not ${listWords(beyondOwner)}, so the key may not either.` };
    }
    const beyondCaller = beyond(added, groupPermissions(currentUser.group));
    if (beyondCaller.length > 0) {
      return { success: false, error: `Your group may not ${listWords(beyondCaller)}, so you cannot give it to a key.` };
    }

    const change = await apiKeyService.update(keyId.data, {
      name: parsed.data.name,
      permissions,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    });
    revalidatePath("/dashboard/users");

    const before = new Set(change.before.permissions);
    const after = new Set<string>(permissions);
    await auditService.log(
      currentUser.id,
      AUDIT_ACTIONS.UPDATE,
      AUDIT_RESOURCES.API_KEY,
      {
        name: parsed.data.name,
        ...(change.before.name !== parsed.data.name ? { renamedFrom: change.before.name } : {}),
        added: permissions.filter((permission) => !before.has(permission)),
        removed: [...before].filter((permission) => !after.has(permission)),
        areas: areaChanges(before, after).map((entry) => ({ area: entry.area.id, from: entry.from, to: entry.to })),
        expiresAt: parsed.data.expiresAt,
      },
      keyId.data
    );

    return { success: true };
  } catch (error) {
    if (error instanceof NotFoundError) return { success: false, error: "The key no longer exists." };
    log.error("Failed to update API key", { id: keyId.data }, wrapError(error));
    return { success: false, error: "The key could not be saved." };
  }
}

/**
 * Delete an API key by ID.
 */
export async function deleteApiKey(id: string) {
  await checkPermission(PERMISSIONS.API_KEYS.WRITE);
  const currentUser = await getCurrentUserWithGroup();

  try {
    const existing = await apiKeyService.getById(id);

    await apiKeyService.delete(id);

    revalidatePath("/dashboard/users");

    if (currentUser) {
      await auditService.log(
        currentUser.id,
        AUDIT_ACTIONS.DELETE,
        AUDIT_RESOURCES.API_KEY,
        { name: existing.name, prefix: existing.prefix },
        id
      );
    }

    return { success: true };
  } catch (error) {
    log.error("Failed to delete API key", { id }, wrapError(error));
    return { success: false, error: getErrorMessage(error) || "Failed to delete API key" };
  }
}

/**
 * Enable or disable an API key.
 */
export async function toggleApiKey(id: string, enabled: boolean) {
  await checkPermission(PERMISSIONS.API_KEYS.WRITE);
  const currentUser = await getCurrentUserWithGroup();

  try {
    const result = await apiKeyService.toggle(id, enabled);

    revalidatePath("/dashboard/users");

    if (currentUser) {
      await auditService.log(
        currentUser.id,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.API_KEY,
        { name: result.name, enabled },
        id
      );
    }

    return { success: true, data: result };
  } catch (error) {
    log.error("Failed to toggle API key", { id, enabled }, wrapError(error));
    return { success: false, error: getErrorMessage(error) || "Failed to toggle API key" };
  }
}

/**
 * Rotate an API key - generates a new secret. Returns the new raw key ONCE.
 */
export async function rotateApiKey(id: string) {
  await checkPermission(PERMISSIONS.API_KEYS.WRITE);
  const currentUser = await getCurrentUserWithGroup();

  try {
    // Rotating hands out the new secret. Only its owner, or someone who may do all the key may do, gets it.
    const owner = await apiKeyService.ownerOf(id);
    if (currentUser?.id !== owner.ownerId) {
      const refused = beyond(owner.permissions.filter((permission) => groupPermissions(owner.group).includes(permission)), groupPermissions(currentUser?.group));
      if (refused.length > 0) {
        return { success: false, error: `The key may ${listWords(refused)}, which your group may not, so only its owner rotates it.` };
      }
    }

    const result = await apiKeyService.rotate(id);

    revalidatePath("/dashboard/users");

    if (currentUser) {
      await auditService.log(
        currentUser.id,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.API_KEY,
        { name: result.apiKey.name, action: "rotate" },
        id
      );
    }

    return {
      success: true,
      data: {
        apiKey: result.apiKey,
        rawKey: result.rawKey,
      },
    };
  } catch (error) {
    log.error("Failed to rotate API key", { id }, wrapError(error));
    return { success: false, error: getErrorMessage(error) || "Failed to rotate API key" };
  }
}

/** Deletes several API keys, reporting per-key outcomes. */
export async function bulkDeleteApiKeys(ids: string[]) {
    await checkPermission(PERMISSIONS.API_KEYS.WRITE);
    const currentUser = await getCurrentUserWithGroup();

    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success) return { success: false as const, error: "Invalid request" };

    try {
        const result = await apiKeyService.deleteMany(parsed.data);
        revalidatePath("/dashboard/users");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.DELETE,
                AUDIT_RESOURCES.API_KEY,
                { bulk: true, requested: parsed.data.length, succeeded: result.succeeded.length, failed: result.failed.length }
            );
        }

        return { success: true as const, data: result };
    } catch (error: unknown) {
        log.error("Failed to bulk delete API keys", {}, wrapError(error));
        return { success: false as const, error: getErrorMessage(error) || "Failed to delete API keys" };
    }
}

/** Enables or disables several API keys. Absolute, so a mixed selection converges. */
export async function bulkToggleApiKeys(ids: string[], enabled: boolean) {
    await checkPermission(PERMISSIONS.API_KEYS.WRITE);
    const currentUser = await getCurrentUserWithGroup();

    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success) return { success: false as const, error: "Invalid request" };

    try {
        const result = await apiKeyService.toggleMany(parsed.data, enabled);
        revalidatePath("/dashboard/users");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.UPDATE,
                AUDIT_RESOURCES.API_KEY,
                { bulk: true, enabled, requested: parsed.data.length, succeeded: result.succeeded.length, failed: result.failed.length }
            );
        }

        return { success: true as const, data: result };
    } catch (error: unknown) {
        log.error("Failed to bulk toggle API keys", {}, wrapError(error));
        return { success: false as const, error: getErrorMessage(error) || "Failed to update API keys" };
    }
}
