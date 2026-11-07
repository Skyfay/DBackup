"use server"

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { apiKeyService } from "@/services/auth/api-key-service";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { diffFields } from "@/lib/core/audit-diff";
import { logger } from "@/lib/logging/logger";
import { wrapError, NotFoundError, PermissionError } from "@/lib/logging/errors";
import type { LogContext } from "@/lib/logging/logger";
import { userMessage } from "@/lib/logging/user-message";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { areaChanges, knownKeyPermissions, permissionPhrase } from "@/lib/auth/permission-areas";
import { sharesWithCustomers } from "@/services/tenant/shared-servers";
import { listWords } from "@/lib/auth/access-summary";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { endsNoLater, holdsKey, LATER_END_REFUSAL, PERMISSIONS_REFUSAL, RESUME_REFUSAL, ROTATE_REFUSAL, samePermissions, type KeyActor } from "@/lib/auth/api-key-change-rule";

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
const KEY_GONE = "The key no longer exists.";

/** The answer for an error of an action on keys: a key that is gone, a refusal in its words, anything else a fixed sentence and the log. */
const failure = (error: unknown, fallback: string, what: string, context: LogContext = {}) =>
  error instanceof NotFoundError ? KEY_GONE : userMessage(error, fallback, log, what, context);

/** The end of a key as the audit log shows it, to the minute in UTC, or Never. */
const endText = (end: Date | null) => (end ? `${end.toISOString().slice(0, 16).replace("T", " ")} UTC` : "Never");

/** The names of the permissions beyond what may be given, for the refusal. */
function beyond(requested: string[], allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  return requested.filter((permission) => !allowedSet.has(permission)).map(permissionPhrase);
}

/**
 * Why someone may not rotate a key or enable it again, null when they may: only its owner and a
 * platform admin, see `holdsKey`. Anyone else who may change API keys only disables, deletes,
 * renames or shortens it. Throws `NotFoundError` for a key that is gone.
 */
async function holderRefusal(id: string, viewer: KeyActor | null, refusal: string): Promise<string | null> {
  const owner = await apiKeyService.ownerOf(id);
  return holdsKey(viewer, owner.ownerId) ? null : refusal;
}

/** The names of keys by id, for the audit log of a bulk run. */
async function keyNames(ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = new Set(ids);
  return new Map((await apiKeyService.list()).filter((key) => wanted.has(key.id)).map((key) => [key.id, key.name]));
}

/** `holderRefusal` for a bulk run, which records a refusal as the failure of that key. */
const bulkGuard = (viewer: KeyActor | null, refusal: string) => async (id: string) => {
  const refused = await holderRefusal(id, viewer, refusal);
  if (refused) throw new PermissionError("api-keys:write", { message: refused });
};

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Creates an API key owned by the caller. It never gets more than the group of the caller may do,
 * and it is checked against that group at every request too. Returns the key once.
 */
export async function createApiKey(data: CreateApiKeyFormValues) {
  const currentUser = await checkPermission(PERMISSIONS.API_KEYS.WRITE);

  const parsed = CreateApiKeySchema.safeParse(data);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  if (!currentUser.tenantId) return { success: false, error: "Open a tenant, a key works in the tenant it was made in." };
  const permissions = knownKeyPermissions(parsed.data.permissions, await sharesWithCustomers(currentUser.tenantId), currentUser.tenantId === HOME_TENANT_ID);
  if (permissions.length === 0) return { success: false, error: "Give the key at least one permission." };
  // What a key of the caller may do there, which leaves out the rights of their platform group on the platform.
  const refused = beyond(permissions, await apiKeyService.ceilingFor(currentUser.id, currentUser.tenantId));
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
    return { success: false, error: failure(error, "The key could not be created. The server log has the details.", "Failed to create API key") };
  }
}

/**
 * Changes the name, the permissions and the end of a key. Its owner and a platform admin change
 * all of it, and a permission it gets new is never more than the group of its owner may do, nor
 * more than the caller may do themselves. Anyone else only renames it or lets it run out sooner,
 * see `holdsKey`.
 */
export async function updateApiKey(id: string, data: UpdateApiKeyFormValues) {
  const currentUser = await checkPermission(PERMISSIONS.API_KEYS.WRITE);
  const keyId = IdSchema.safeParse(id);
  const parsed = KeyFieldsSchema.safeParse(data);
  if (!keyId.success || !parsed.success) return { success: false, error: parsed.error?.issues[0]?.message ?? "Invalid request" };

  const shares = await sharesWithCustomers(currentUser.tenantId);
  const home = currentUser.tenantId === HOME_TENANT_ID;
  const permissions = knownKeyPermissions(parsed.data.permissions, shares, home);
  if (permissions.length === 0) return { success: false, error: "Give the key at least one permission." };
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;

  try {
    const owner = await apiKeyService.ownerOf(keyId.data);
    let saved: Permission[] = permissions;
    if (!holdsKey(currentUser, owner.ownerId)) {
      // Anyone else only takes access away, since a key acts as its owner. What it holds stays as stored.
      if (!samePermissions(permissions, knownKeyPermissions(owner.permissions, shares, home))) return { success: false, error: PERMISSIONS_REFUSAL };
      const existing = await apiKeyService.getById(keyId.data);
      if (!endsNoLater(existing.expiresAt, expiresAt)) return { success: false, error: LATER_END_REFUSAL };
      saved = owner.permissions as Permission[];
    } else {
      // Only what the key gets new is checked. What it keeps, even paused, stays as it was.
      const stored = new Set(owner.permissions);
      const added = permissions.filter((permission) => !stored.has(permission));
      const beyondOwner = beyond(added, owner.ownerPermissions);
      if (beyondOwner.length > 0) {
        return { success: false, error: `The group of its owner may not ${listWords(beyondOwner)}, so the key may not either.` };
      }
      const beyondCaller = beyond(added, currentUser.permissions);
      if (beyondCaller.length > 0) {
        return { success: false, error: `Your group may not ${listWords(beyondCaller)}, so you cannot give it to a key.` };
      }
    }
    if (await apiKeyService.nameTaken(parsed.data.name, keyId.data)) return { success: false, error: NAME_TAKEN };

    const change = await apiKeyService.update(keyId.data, { name: parsed.data.name, permissions: saved, expiresAt });
    revalidatePath("/dashboard/users");

    const before = new Set(change.before.permissions);
    const after = new Set<string>(saved);
    await auditService.log(
      currentUser.id,
      AUDIT_ACTIONS.UPDATE,
      AUDIT_RESOURCES.API_KEY,
      {
        name: parsed.data.name,
        ...(change.before.name !== parsed.data.name ? { renamedFrom: change.before.name } : {}),
        added: saved.filter((permission) => !before.has(permission)),
        removed: [...before].filter((permission) => !after.has(permission)),
        areas: areaChanges(before, after).map((entry) => ({ area: entry.area.id, from: entry.from, to: entry.to })),
        expiresAt: parsed.data.expiresAt,
        changes: diffFields({ expires: endText(change.before.expiresAt) }, { expires: endText(expiresAt) }, { expires: { label: "Expires" } }),
      },
      keyId.data
    );

    return { success: true };
  } catch (error) {
    if (error instanceof NotFoundError) return { success: false, error: KEY_GONE };
    log.error("Failed to update API key", { id: keyId.data }, wrapError(error));
    return { success: false, error: "The key could not be saved." };
  }
}

/**
 * Deletes an API key, any key of the tenant, since deleting only takes access away.
 */
export async function deleteApiKey(keyId: string) {
  const currentUser = await checkPermission(PERMISSIONS.API_KEYS.WRITE);
  const parsed = IdSchema.safeParse(keyId);
  if (!parsed.success) return { success: false, error: "Invalid request" };
  const id = parsed.data;

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
    return { success: false, error: failure(error, "The key could not be deleted. The server log has the details.", "Failed to delete API key", { id }) };
  }
}

/**
 * Enables or disables an API key. Anyone who may change API keys disables one, only its owner and
 * a platform admin enable a key of someone else again, see `holdsKey`.
 */
export async function toggleApiKey(keyId: string, on: boolean) {
  const currentUser = await checkPermission(PERMISSIONS.API_KEYS.WRITE);
  const input = z.object({ id: IdSchema, enabled: z.boolean() }).safeParse({ id: keyId, enabled: on });
  if (!input.success) return { success: false, error: "Invalid request" };
  const { id, enabled } = input.data;

  try {
    const refusal = enabled ? await holderRefusal(id, currentUser, RESUME_REFUSAL) : null;
    if (refusal) return { success: false, error: refusal };
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
    return { success: false, error: failure(error, "The key could not be changed. The server log has the details.", "Failed to toggle API key", { id, enabled }) };
  }
}

/**
 * Rotates an API key: a new secret, returned once. Only its owner and a platform admin, since the
 * secret acts as its owner, see `holdsKey`.
 */
export async function rotateApiKey(keyId: string) {
  const currentUser = await checkPermission(PERMISSIONS.API_KEYS.WRITE);
  const parsed = IdSchema.safeParse(keyId);
  if (!parsed.success) return { success: false, error: "Invalid request" };
  const id = parsed.data;

  try {
    const refusal = await holderRefusal(id, currentUser, ROTATE_REFUSAL);
    if (refusal) return { success: false, error: refusal };

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
    return { success: false, error: failure(error, "The key could not be rotated. The server log has the details.", "Failed to rotate API key", { id }) };
  }
}

/** Deletes several API keys, any of the tenant, reporting per-key outcomes. */
export async function bulkDeleteApiKeys(ids: string[]) {
    const currentUser = await checkPermission(PERMISSIONS.API_KEYS.WRITE);

    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success) return { success: false as const, error: "Invalid request" };

    try {
        // Read first, the keys are gone afterwards.
        const names = await keyNames(parsed.data);
        const result = await apiKeyService.deleteMany(parsed.data);
        revalidatePath("/dashboard/users");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.DELETE,
                AUDIT_RESOURCES.API_KEY,
                { bulk: true, requested: parsed.data.length, succeeded: result.succeeded.length, failed: result.failed.length, names: result.succeeded.flatMap((id) => names.get(id) ?? []) }
            );
        }

        return { success: true as const, data: result };
    } catch (error: unknown) {
        return { success: false as const, error: failure(error, "The keys could not be deleted. The server log has the details.", "Failed to bulk delete API keys") };
    }
}

/**
 * Enables or disables several API keys. Absolute, so a mixed selection converges. Enabling refuses
 * the keys of others to anyone but a platform admin, like `toggleApiKey`.
 */
export async function bulkToggleApiKeys(ids: string[], enabled: boolean) {
    const currentUser = await checkPermission(PERMISSIONS.API_KEYS.WRITE);

    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success || typeof enabled !== "boolean") return { success: false as const, error: "Invalid request" };

    try {
        const names = await keyNames(parsed.data);
        const result = await apiKeyService.toggleMany(parsed.data, enabled, enabled ? bulkGuard(currentUser, RESUME_REFUSAL) : undefined);
        revalidatePath("/dashboard/users");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.UPDATE,
                AUDIT_RESOURCES.API_KEY,
                { bulk: true, enabled, requested: parsed.data.length, succeeded: result.succeeded.length, failed: result.failed.length, names: result.succeeded.flatMap((id) => names.get(id) ?? []) }
            );
        }

        return { success: true as const, data: result };
    } catch (error: unknown) {
        return { success: false as const, error: failure(error, "The keys could not be changed. The server log has the details.", "Failed to bulk toggle API keys") };
    }
}
