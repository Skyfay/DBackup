/**
 * Editing a connection: its name, config, logins, metadata and, for storage, its role. Every
 * check an edit has to pass lives here, in the order the API has always answered them.
 */

import type { AdapterConfig } from "@prisma/client";
import prisma from "@/lib/prisma";
import { encryptConfig, decryptConfig, mergeSecrets } from "@/lib/crypto";
import { STORAGE_ROLES, isStorageRole, type StorageRole } from "@/lib/core/storage-roles";
import type { AuditChange } from "@/lib/core/audit-types";
import { registerAdapters } from "@/lib/adapters";
import { validateCredentialAssignments } from "@/lib/adapters/credential-validation";
import { validateStorageRole } from "@/lib/adapters/role-validation";
import { validateSnapshotConfig } from "@/lib/adapters/snapshot-validation";
import { logger } from "@/lib/logging/logger";
import { ConflictError, ValidationError, wrapError } from "@/lib/logging/errors";
import { connectionChanges } from "./adapter-audit";

registerAdapters();

const log = logger.child({ service: "AdapterUpdate" });

/**
 * A role or a shadow copy setting the adapter cannot serve. The API answers these with
 * `success: false` beside the error, unlike the other refusals of an edit, so they need telling apart.
 */
export class UnsupportedSettingError extends ValidationError {}

/** The fields of an edit. A field left out stays as it is. */
export interface UpdateAdapterInput {
    name?: string;
    config?: Record<string, unknown> | string;
    metadata?: unknown;
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
    /** A storage role. Anything else is refused. */
    storageRole?: unknown;
}

export interface AdapterUpdateResult {
    /** The connection as it is stored now. */
    adapter: AdapterConfig;
    /** The name before the edit, for the audit entry of a rename. */
    previousName: string;
    /** What the edit changed. A changed secret is only marked as changed. */
    changes: AuditChange[];
}

const kindName = (type: string) => (type === "database" ? "source" : type === "storage" ? "destination" : "notification");

/** What the edit compares with, read before anything changes. */
const EXISTING_SELECT = {
    type: true, adapterId: true, lastError: true, config: true, storageRole: true,
    name: true, primaryCredentialId: true, sshCredentialId: true, metadata: true,
} as const;

/**
 * Checks and stores an edit of a connection. Null when the connection does not exist.
 *
 * @throws ValidationError for a credential profile of the wrong type, an unknown role or a role
 *   change while a job still depends on the old one.
 * @throws UnsupportedSettingError for a role or shadow copies the adapter cannot serve.
 * @throws NotFoundError for a credential profile that does not exist.
 * @throws ConflictError when a connection of the same type has the name already.
 */
export async function updateAdapter(id: string, input: UpdateAdapterInput): Promise<AdapterUpdateResult | null> {
    const existing = await prisma.adapterConfig.findUnique({ where: { id }, select: EXISTING_SELECT });
    if (!existing) return null;

    const { name, config, metadata, primaryCredentialId, sshCredentialId, storageRole } = input;

    if (primaryCredentialId !== undefined || sshCredentialId !== undefined) {
        await validateCredentialAssignments(existing.adapterId, primaryCredentialId ?? null, sshCredentialId ?? null);
    }

    if (name) {
        const taken = await prisma.adapterConfig.findFirst({ where: { name, type: existing.type, id: { not: id } } });
        if (taken) {
            throw new ConflictError(`A ${kindName(existing.type)} with the name "${name}" already exists.`);
        }
    }

    // The API returns secrets redacted, so an edit sends them back empty. They are filled from
    // the saved config before encrypting again, or a real secret would be overwritten with nothing.
    let configString: string | undefined;
    // The merged config in plain text, for the snapshot check, which has to probe with the real secrets.
    let mergedConfig: Record<string, unknown> | undefined;
    // The config as it was, which the audit entry compares the merged one with.
    let existingConfig: unknown = {};
    if (config !== undefined) {
        const incoming = typeof config === "string" ? JSON.parse(config) : config;
        try {
            existingConfig = decryptConfig(JSON.parse(existing.config));
        } catch (e) {
            log.warn("Failed to decrypt existing config during update; secret merge skipped", { adapterId: id }, wrapError(e));
        }
        mergedConfig = mergeSecrets(incoming, existingConfig) as Record<string, unknown>;
        configString = JSON.stringify(encryptConfig(mergedConfig));
    }

    if (storageRole !== undefined && !isStorageRole(storageRole)) {
        throw new ValidationError("Invalid storage role", { field: "storageRole" });
    }
    // Before the in-use checks, because a role the adapter cannot serve at all should say so
    // plainly rather than name the jobs in the way of a move that was never possible.
    if (isStorageRole(storageRole) && existing.type === "storage") {
        try {
            validateStorageRole(existing.adapterId, storageRole);
        } catch (e) {
            throw asUnsupported(e);
        }
    }
    if (isStorageRole(storageRole) && storageRole !== existing.storageRole) {
        await assertRoleFree(id, storageRole);
    }

    // The same gate as on create: the stored config has to be one the server can honour.
    if (mergedConfig !== undefined) {
        const effectiveRole = isStorageRole(storageRole) ? storageRole : (existing.storageRole as StorageRole);
        try {
            await validateSnapshotConfig(existing.adapterId, mergedConfig, effectiveRole, primaryCredentialId ?? null, sshCredentialId ?? null);
        } catch (e) {
            throw asUnsupported(e);
        }
    }

    const adapter = await prisma.adapterConfig.update({
        where: { id },
        data: {
            name,
            ...(configString !== undefined ? { config: configString } : {}),
            ...(primaryCredentialId !== undefined ? { primaryCredentialId: primaryCredentialId ?? null } : {}),
            ...(sshCredentialId !== undefined ? { sshCredentialId: sshCredentialId ?? null } : {}),
            ...(metadata !== undefined ? { metadata: JSON.stringify(metadata) } : {}),
            ...(isStorageRole(storageRole) ? { storageRole } : {}),
            // A login assigned now clears the flag the health check set for the missing one.
            ...(primaryCredentialId && existing.lastError === "No credential profile assigned"
                ? { lastStatus: "ONLINE", lastError: null, consecutiveFailures: 0 }
                : {}),
        },
    });

    const changes = await connectionChanges(
        existing.type,
        existing,
        adapter,
        mergedConfig !== undefined ? { before: existingConfig, after: mergedConfig } : undefined
    );
    return { adapter, previousName: existing.name, changes };
}

/**
 * A role change drops the connection out of every list its old role appeared in, so it is
 * refused while a job still depends on that role rather than breaking the job.
 */
async function assertRoleFree(id: string, storageRole: StorageRole): Promise<void> {
    if (storageRole === STORAGE_ROLES.SOURCE) {
        const linked = await prisma.jobDestination.findMany({ where: { configId: id }, select: { job: { select: { name: true } } } });
        if (linked.length > 0) {
            throw new ValidationError(
                `Cannot turn this into a directory source: it is used as a destination in ${linked.map((d) => d.job.name).join(", ")}.`,
                { field: "storageRole" }
            );
        }
        return;
    }
    const linked = await prisma.jobSource.findMany({ where: { configId: id }, select: { job: { select: { name: true } } } });
    if (linked.length > 0) {
        throw new ValidationError(
            `Cannot turn this into a destination: it is used as a directory source in ${linked.map((s) => s.job.name).join(", ")}.`,
            { field: "storageRole" }
        );
    }
}

/** A refusal of the role or the shadow copy check as the error the API answers with `success: false`. Anything else stays as it is. */
function asUnsupported(error: unknown): unknown {
    return error instanceof ValidationError ? new UnsupportedSettingError(error.message, { field: error.field, cause: error }) : error;
}
