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
import { connectionNames } from "@/services/audit/record-names";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { diffFields } from "@/lib/core/audit-diff";
import { logger } from "@/lib/logging/logger";
import { userMessage } from "@/lib/logging/user-message";
import { PermissionError } from "@/lib/logging/errors";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { DeleteModeSchema, PERMANENT_DELETE_REFUSED, type DeleteMode } from "@/lib/core/delete-mode";
import { isKeyHex, keyIdOf } from "@/services/vault/key-id";
import { VAULT_AUDIT } from "@/services/vault/vault-audit";
import { configBackupTargetRefusal } from "@/lib/server/config-backup-target-guard";
import { configBackupFileRefusal } from "@/lib/server/config-backup-guard";
import { backupPathIssue } from "@/lib/server/backup-path-schema";
import { z } from "zod";

/**
 * Who reads the list of keys: the Vault, and the job form that picks one. The settings of the
 * instance give no right to the keys of a tenant, the configuration backup reads the keys of the
 * home tenant through its own service.
 */
const KEY_READERS = [PERMISSIONS.VAULT.READ, PERMISSIONS.VAULT.WRITE, PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.WRITE];

const IdSchema = z.string().min(1).max(200);

const log = logger.child({ action: "encryption" });

/** The answer for an error of a Vault action: a refusal or a conflict in its words, anything else a fixed sentence and the log. */
const failure = (error: unknown) => userMessage(error, "Something went wrong with the key. The server log has the details.", log, "A Vault action failed");

/** A Server Action runs with a session, never with an API key. */
const asCaller = (viewer: { isPlatformAdmin: boolean; tenantId: string | null }) => ({ isPlatformAdmin: viewer.isPlatformAdmin, authMethod: "session" as const, tenantId: viewer.tenantId });

/** What the edit dialog of a key can change besides its name, which an entry keeps as `renamedFrom`. */
const KEY_FIELDS = { description: { label: "Description" } };

const UpdateEncryptionProfileSchema = z.object({
    id: IdSchema,
    name: z.string().trim().min(1).max(100),
    // An emptied description field clears the description instead of storing "".
    description: z.string().trim().max(500).nullable().optional().transform((value) => value || null),
});

/** The name of a key, as the edit dialog takes it. */
const KeyNameSchema = z.string().trim().min(1).max(100);
/** An empty description is none. */
const KeyDescriptionSchema = z.string().trim().max(500).optional().transform((value) => value || undefined);
/** A key typed or pasted in, 64 hex characters. */
const KeyHexSchema = z.string().trim().refine(isKeyHex, "A key is 64 hex characters.");

const CreateEncryptionProfileSchema = z.object({ name: KeyNameSchema, description: KeyDescriptionSchema });

const ImportEncryptionProfileSchema = z.object({
    name: KeyNameSchema,
    keyHex: KeyHexSchema,
    description: KeyDescriptionSchema,
    // The ids the key had in the install its recovery kit came from.
    standsFor: z.array(z.string().min(1).max(64)).max(20),
});

const RecoverEncryptionKeySchema = z.object({
    storageConfigId: IdSchema,
    file: z.string().min(1).max(4096).refine((value) => !value.includes("\0"), "Invalid path").superRefine(backupPathIssue),
    keyHex: KeyHexSchema,
    name: KeyNameSchema.optional(),
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
        return { success: false, error: failure(e) };
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
        return { success: false, error: failure(e) };
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
    // The key of the configuration backup shows only to a platform admin.
    const locked = await configBackupTargetRefusal(asCaller(user), { profileIds: [parsed.data] });
    if (locked) return { success: false, error: locked };

    try {
        // The key without its secret, which names the entry. Nothing is revealed of a key that is gone.
        const profile = await encryptionService.getEncryptionProfile(parsed.data);
        if (!profile) return { success: false, error: `Encryption profile ${parsed.data} not found` };
        await auditService.log(user.id, AUDIT_ACTIONS.EXPORT, AUDIT_RESOURCES.VAULT, { action: VAULT_AUDIT.REVEAL_KEY, name: profile.name }, parsed.data);
        const key = await encryptionService.getDecryptedMasterKey(parsed.data);
        return { success: true, data: key };
    } catch (e: unknown) {
        return { success: false, error: failure(e) };
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
        return { success: false as const, error: failure(e) };
    }
}

/**
 * Creates a new encryption profile.
 * Requires VAULT:WRITE permission.
 */
export async function createEncryptionProfile(name: string, description?: string) {
    const user = await checkPermission(PERMISSIONS.VAULT.WRITE);

    const parsed = CreateEncryptionProfileSchema.safeParse({ name, description });
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };

    try {
        const profile = await encryptionService.createEncryptionProfile(parsed.data.name, parsed.data.description);
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
        return { success: false, error: failure(e) };
    }
}

/**
 * Imports an existing encryption profile from a master key.
 * Requires VAULT:WRITE permission.
 */
export async function importEncryptionProfile(name: string, keyHex: string, description?: string, standsFor: string[] = []) {
    const user = await checkPermission(PERMISSIONS.VAULT.WRITE);

    const parsed = ImportEncryptionProfileSchema.safeParse({ name, keyHex, description, standsFor });
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };

    try {
        const { data } = parsed;
        const profile = await encryptionService.importEncryptionProfile(data.name, data.keyHex, data.description, data.standsFor);
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
        return { success: false, error: failure(e) };
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
    // The key of the configuration backup is changed only by a platform admin, like it is deleted.
    const locked = await configBackupTargetRefusal(asCaller(user), { profileIds: [parsed.data.id] });
    if (locked) return { success: false, error: locked };

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
        return { success: false, error: failure(e) };
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
    const locked = await configBackupTargetRefusal(asCaller(user), { profileIds: [parsedId.data] });
    if (locked) return { success: false, error: locked };

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
        return { success: false, error: failure(e) };
    }
}

/**
 * Tests a key the user supplied against one backup and, if it fits, stores it in the vault.
 *
 * This is what the recovery dialog calls. Importing rather than using the key once is
 * deliberate: it is the only way the key also reaches the flows that have nobody to ask -
 * a background restore, a scheduled config restore, the next request of this same page.
 *
 * Requires VAULT:WRITE, because it creates a profile, and STORAGE:READ, because it reads the
 * `.meta.json` of a backup at a destination.
 */
export async function recoverEncryptionKeyAction(
    storageConfigId: string,
    file: string,
    keyHex: string,
    name?: string
) {
    const user = await checkPermission(PERMISSIONS.VAULT.WRITE);
    await checkPermission(PERMISSIONS.STORAGE.READ);

    const parsed = RecoverEncryptionKeySchema.safeParse({ storageConfigId, file, keyHex, name });
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    const input = parsed.data;

    try {
        // A configuration backup is only for a platform admin, also to try a key on.
        const refused = await configBackupFileRefusal(asCaller(user), input.storageConfigId, input.file);
        if (refused) return { success: false, error: refused };

        const result = await recoverEncryptionKey(input.storageConfigId, input.file, input.keyHex, input.name, {
            // A key the Vault holds already notes the backups it opens, which changes the key of the
            // configuration backup only for a platform admin.
            beforeNote: async (profileId) => {
                const locked = await configBackupTargetRefusal(asCaller(user), { profileIds: [profileId] });
                if (locked) throw new PermissionError("platform admin", { message: locked });
            },
        });

        // A try that changed nothing in the Vault still read a backup at a destination with its saved
        // login, so it gets an entry like any other look at a server, with the backup and whether
        // the key opened it, never the key.
        if (result.status === "rejected" || (result.status === "existing" && !result.notedFor)) {
            const destination = (await connectionNames([input.storageConfigId])).get(input.storageConfigId);
            await auditService.log(
                user.id,
                AUDIT_ACTIONS.EXECUTE,
                AUDIT_RESOURCES.VAULT,
                {
                    action: "key_check",
                    file: input.file,
                    ...(destination ? { destination } : {}),
                    ...(result.status === "existing" && result.profileName ? { keyName: result.profileName } : {}),
                    success: result.status === "existing",
                },
                result.status === "existing" ? result.profileId : undefined
            );
        }

        if (result.status === "rejected") {
            return { success: false, error: "This key does not open this backup." };
        }

        // A fresh profile is created. A key the Vault held already changes only when it now opens the
        // backups of another profile id too, which the Vault counts under it from now on.
        if (result.status === "imported") {
            await auditService.log(
                user.id,
                AUDIT_ACTIONS.CREATE,
                AUDIT_RESOURCES.VAULT,
                { type: "EncryptionProfile", name: result.profileName, method: "Recovery" },
                result.profileId
            );
        } else if (result.notedFor) {
            await auditService.log(
                user.id,
                AUDIT_ACTIONS.UPDATE,
                AUDIT_RESOURCES.VAULT,
                { type: "EncryptionProfile", name: result.profileName, method: "Recovery", standsFor: result.notedFor },
                result.profileId
            );
        }

        revalidatePath("/dashboard/vault");
        return { success: true, data: result };
    } catch (e: unknown) {
        return { success: false, error: failure(e) };
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
    const locked = await configBackupTargetRefusal(asCaller(user), { profileIds: parsed.data });
    if (locked) return { success: false as const, error: locked };

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
        return { success: false as const, error: failure(e) };
    }
}
