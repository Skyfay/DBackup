'use server';

import { checkPermission, checkPlatformAdmin, hasPermission, tenantRefusal } from "@/lib/auth/access-control";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { PERMISSIONS, TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import * as encryptionService from "@/services/backup/encryption-service";
import { recoverEncryptionKey } from "@/services/backup/key-recovery";
import { archiveIndexService } from "@/services/backup/archive-index-service";
import { revalidatePath } from "next/cache";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { diffFields } from "@/lib/core/audit-diff";
import { getErrorMessage } from "@/lib/logging/errors";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { DeleteModeSchema, PERMANENT_DELETE_REFUSED, type DeleteMode } from "@/lib/core/delete-mode";
import { isKeyHex, keyIdOf } from "@/services/vault/key-id";
import { VAULT_AUDIT } from "@/services/vault/vault-audit";
import { z } from "zod";

/**
 * Who reads the list of keys: the Vault, and the job form that picks one. The settings of the
 * instance give no right to the keys of a tenant, the configuration backup reads the keys of the
 * home tenant through its own service.
 */
const KEY_READERS = [PERMISSIONS.VAULT.READ, PERMISSIONS.VAULT.WRITE, PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.WRITE];

const IdSchema = z.string().min(1).max(200);

/** What the edit dialog of a key can change besides its name, which an entry keeps as `renamedFrom`. */
const KEY_FIELDS = { description: { label: "Description" } };

const UpdateEncryptionProfileSchema = z.object({
    id: IdSchema,
    name: z.string().trim().min(1).max(100),
    // An emptied description field clears the description instead of storing "".
    description: z.string().trim().max(500).nullable().optional().transform((value) => value || null),
});

/**
 * Returns all encryption profiles.
 * Requires VAULT:READ, VAULT:WRITE, JOBS:READ or JOBS:WRITE permission.
 */
export async function getEncryptionProfiles() {
    const viewer = await checkPermission(KEY_READERS).catch(() => null);
    if (!viewer) return { success: false, error: "Insufficient permissions" };
    // Keys belong to a tenant and the job form asks in one, All tenants would mix those of every tenant.
    const refused = tenantRefusal(viewer);
    if (refused) return { success: false, error: refused };

    try {
        const profiles = await encryptionService.getEncryptionProfiles();
        return { success: true, data: profiles };
    } catch (e: unknown) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * The keys of the home tenant, for the restore of a configuration backup, which is encrypted with
 * one of them whichever tenant the platform admin works in. Only a platform admin restores one.
 */
export async function getPlatformEncryptionProfiles() {
    await checkPlatformAdmin();
    try {
        const profiles = await runAsTenant(HOME_TENANT_ID, () => encryptionService.getEncryptionProfiles());
        return { success: true, data: profiles };
    } catch (e: unknown) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Reveals the decrypted master key for a profile.
 * Requires VAULT:WRITE permission (highly sensitive), and is written to the audit log before the
 * key leaves, like a revealed credential.
 */
export async function revealMasterKey(id: string) {
    const user = await checkPermission(PERMISSIONS.VAULT.WRITE);

    const parsed = IdSchema.safeParse(id);
    if (!parsed.success) return { success: false, error: "Invalid request" };

    try {
        // The key without its secret, which names the entry. Nothing is revealed of a key that is gone.
        const profile = await encryptionService.getEncryptionProfile(parsed.data);
        if (!profile) return { success: false, error: `Encryption profile ${parsed.data} not found` };
        await auditService.log(user.id, AUDIT_ACTIONS.EXPORT, AUDIT_RESOURCES.VAULT, { action: VAULT_AUDIT.REVEAL_KEY, name: profile.name }, parsed.data);
        const key = await encryptionService.getDecryptedMasterKey(parsed.data);
        return { success: true, data: key };
    } catch (e: unknown) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Tells the import dialog the Key ID of a key typed into it, and whether the Vault holds that key
 * already. Requires VAULT:WRITE, like the import it prepares.
 */
export async function inspectEncryptionKey(keyHex: string) {
    await checkPermission(PERMISSIONS.VAULT.WRITE);

    const parsed = z.string().trim().refine(isKeyHex).safeParse(keyHex);
    if (!parsed.success) return { success: false as const, error: "A key is 64 hex characters." };

    try {
        const existing = await encryptionService.findProfileByKey(parsed.data);
        return { success: true as const, data: { keyId: keyIdOf(parsed.data), existing } };
    } catch (e: unknown) {
        return { success: false as const, error: getErrorMessage(e) };
    }
}

/**
 * Creates a new encryption profile.
 * Requires VAULT:WRITE permission.
 */
export async function createEncryptionProfile(name: string, description?: string) {
    const user = await checkPermission(PERMISSIONS.VAULT.WRITE);

    try {
        const profile = await encryptionService.createEncryptionProfile(name, description);
        await auditService.log(
            user.id,
            AUDIT_ACTIONS.CREATE,
            AUDIT_RESOURCES.VAULT,
            { type: "EncryptionProfile", name: profile.name },
            profile.id
        );
        revalidatePath("/dashboard/vault");
        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard/jobs"); // Revalidate jobs usually where dropdowns are
        return { success: true, data: profile };
    } catch (e: unknown) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Imports an existing encryption profile from a master key.
 * Requires VAULT:WRITE permission.
 */
export async function importEncryptionProfile(name: string, keyHex: string, description?: string, standsFor: string[] = []) {
    const user = await checkPermission(PERMISSIONS.VAULT.WRITE);

    // The ids the key had in the install its recovery kit came from.
    const formerIds = z.array(z.string().min(1).max(64)).max(20).safeParse(standsFor);
    if (!formerIds.success) return { success: false, error: "Invalid request" };

    try {
        const profile = await encryptionService.importEncryptionProfile(name, keyHex, description, formerIds.data);
        await auditService.log(
            user.id,
            AUDIT_ACTIONS.CREATE,
            AUDIT_RESOURCES.VAULT,
            { type: "EncryptionProfile", name: profile.name, method: "Import" },
            profile.id
        );
        revalidatePath("/dashboard/vault");
        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard/jobs");
        return { success: true, data: profile };
    } catch (e: unknown) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Renames an encryption profile and updates its description.
 * Requires VAULT:WRITE permission.
 */
export async function updateEncryptionProfile(id: string, input: { name: string; description?: string | null }) {
    const user = await checkPermission(PERMISSIONS.VAULT.WRITE);

    const parsed = UpdateEncryptionProfileSchema.safeParse({ id, ...input });
    if (!parsed.success) return { success: false, error: "Invalid request" };

    try {
        const { profile, previousName, previousDescription } = await encryptionService.updateEncryptionProfile(parsed.data.id, {
            name: parsed.data.name,
            description: parsed.data.description,
        });
        await auditService.log(
            user.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.VAULT,
            {
                type: "EncryptionProfile",
                name: profile.name,
                ...(previousName !== profile.name ? { renamedFrom: previousName } : {}),
                changes: diffFields({ description: previousDescription }, { description: profile.description }, KEY_FIELDS),
            },
            profile.id
        );
        revalidatePath("/dashboard/vault");
        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard/jobs");
        return { success: true, data: profile };
    } catch (e: unknown) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Deletes an encryption profile, which waits in Recently deleted unless `permanently`.
 * Requires VAULT:WRITE permission.
 */
export async function deleteEncryptionProfile(id: string, mode?: DeleteMode) {
    const user = await checkPermission(PERMISSIONS.VAULT.WRITE);

    const parsedId = IdSchema.safeParse(id);
    const parsedMode = DeleteModeSchema.safeParse(mode);
    if (!parsedId.success || !parsedMode.success) return { success: false, error: "Invalid request" };
    const { permanently = false } = parsedMode.data;
    if (permanently && !(await hasPermission(TRASH_ADMIN_PERMISSION))) return { success: false, error: PERMANENT_DELETE_REFUSED };

    try {
        // Permanently, every backup it encrypted is unreadable for good. The dialog warns about it.
        const deleted = await encryptionService.deleteEncryptionProfile(parsedId.data, { permanently, by: user.id });
        // A parsed archive index outlives the key that opened it. Left cached, a backup
        // would keep listing its contents for another five minutes while every restore of
        // it failed - so the vault change drops them here rather than in the service, which
        // the index service already depends on.
        archiveIndexService.clear();
        await auditService.log(
            user.id,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.VAULT,
            { type: "EncryptionProfile", name: deleted.name, ...(permanently ? { permanently: true } : {}) },
            parsedId.data
        );
        revalidatePath("/dashboard/vault");
        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard/jobs");
        return { success: true };
    } catch (e: unknown) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Tests a key the user supplied against one backup and, if it fits, stores it in the vault.
 *
 * This is what the recovery dialog calls. Importing rather than using the key once is
 * deliberate: it is the only way the key also reaches the flows that have nobody to ask -
 * a background restore, a scheduled config restore, the next request of this same page.
 *
 * Requires VAULT:WRITE, because it creates a profile.
 */
export async function recoverEncryptionKeyAction(
    storageConfigId: string,
    file: string,
    keyHex: string,
    name?: string
) {
    const user = await checkPermission(PERMISSIONS.VAULT.WRITE);

    const parsedId = IdSchema.safeParse(storageConfigId);
    if (!parsedId.success) return { success: false, error: "Invalid request" };

    try {
        const result = await recoverEncryptionKey(parsedId.data, file, keyHex, name);

        if (result.status === "rejected") {
            return { success: false, error: "This key does not open this backup." };
        }

        // Only a fresh profile is worth an audit entry - reusing one that was already there
        // changed nothing.
        if (result.status === "imported") {
            await auditService.log(
                user.id,
                AUDIT_ACTIONS.CREATE,
                AUDIT_RESOURCES.VAULT,
                { type: "EncryptionProfile", name: result.profileName, method: "Recovery" },
                result.profileId
            );
        }

        revalidatePath("/dashboard/vault");
        return { success: true, data: result };
    } catch (e: unknown) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Deletes several encryption profiles.
 *
 * The archive index cache is cleared once after the batch rather than per profile. A
 * parsed index outlives the key that opened it, so it has to go, but flushing it inside
 * the loop would discard work the remaining deletions still benefit from.
 */
export async function bulkDeleteEncryptionProfiles(ids: string[], mode?: DeleteMode) {
    const user = await checkPermission(PERMISSIONS.VAULT.WRITE);

    const parsed = BulkIdsSchema.safeParse(ids);
    const parsedMode = DeleteModeSchema.safeParse(mode);
    if (!parsed.success || !parsedMode.success) return { success: false as const, error: "Invalid request" };
    const { permanently = false } = parsedMode.data;
    if (permanently && !(await hasPermission(TRASH_ADMIN_PERMISSION))) return { success: false as const, error: PERMANENT_DELETE_REFUSED };

    try {
        // Read first, the keys are gone afterwards. A Vault holds a handful, so the list is cheap.
        const names = new Map((await encryptionService.getEncryptionProfiles()).map((profile) => [profile.id, profile.name]));
        const result = await encryptionService.deleteEncryptionProfiles(parsed.data, { permanently, by: user.id });

        if (result.succeeded.length > 0) archiveIndexService.clear();

        await auditService.log(
            user.id,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.VAULT,
            {
                type: "EncryptionProfile",
                bulk: true,
                requested: parsed.data.length,
                succeeded: result.succeeded.length,
                failed: result.failed.length,
                names: result.succeeded.flatMap((id) => names.get(id) ?? []),
                ...(permanently ? { permanently: true } : {}),
            }
        );

        revalidatePath("/dashboard/vault");
        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard/jobs");

        return { success: true as const, data: result };
    } catch (e: unknown) {
        return { success: false as const, error: getErrorMessage(e) };
    }
}
