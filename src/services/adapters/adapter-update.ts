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
import { layLoginsOver } from "@/lib/adapters/config-resolver";
import { validateCredentialAssignments } from "@/lib/adapters/credential-validation";
import { validateStorageRole } from "@/lib/adapters/role-validation";
import { validateSnapshotConfig } from "@/lib/adapters/snapshot-validation";
import { logger } from "@/lib/logging/logger";
import { ConflictError, ValidationError, wrapError } from "@/lib/logging/errors";
import { runAsSystem } from "@/lib/tenant/context";
import { currentTenantId } from "@/lib/tenant/current";
import { isShared } from "@/services/sharing/destination-access";
import { assertMayAdd } from "@/services/tenant/tenant-allowances";
import { connectionChanges } from "./adapter-audit";
import { assertMayReachHost } from "./adapter-create";
import { assertOffSharedPlaces } from "./shared-place";

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

/**
 * The keys of a storage config that say where its files are: the server, the account on it, the
 * bucket and the folder. A destination shared with other tenants keeps the backups of each customer
 * under `tenants/<id>/` of that place, so moving it would hand them to its tenant as its own files,
 * or lose them.
 */
const LOCATION_KEYS = [
    "host", "port", "endpoint", "region", "accountId", "bucket", "jurisdiction", "basePath", "address",
    "domain", "url", "pathPrefix", "folderId", "folderPath", "user", "username", "socketPath",
] as const;

export const SHARED_PLACE_STAYS = "It is shared with other tenants, so where it keeps the files stays as it is. Stop sharing it first.";
const SHARED_ROLE_STAYS = "It is shared with other tenants, so it stays a destination. Stop sharing it first.";

/** What the edit compares with, read before anything changes. */
const EXISTING_SELECT = {
    type: true, adapterId: true, lastError: true, config: true, storageRole: true,
    name: true, primaryCredentialId: true, sshCredentialId: true, metadata: true,
} as const;

/**
 * Checks and stores an edit of a connection. Null when the connection does not exist.
 *
 * @throws ValidationError for a credential profile of the wrong type, an unknown role, a role
 *   change while a job still depends on the old one or the destination is shared, a new role the
 *   tenant may not add, a config that reaches the server DBackup runs on outside the platform or the
 *   local network its tenant blocks, a new place for the files of a shared destination, or a place
 *   that overlaps another destination the tenant shares with customers.
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
    // The config as it was, which the audit entry compares the merged one with. Decrypted once,
    // when something needs it.
    let existingConfig: Record<string, unknown> | undefined;
    const readExisting = (): Record<string, unknown> => {
        if (existingConfig === undefined) {
            try {
                existingConfig = decryptConfig(JSON.parse(existing.config)) as Record<string, unknown>;
            } catch (e) {
                log.warn("Failed to decrypt existing config during update, secret merge skipped", { adapterId: id }, wrapError(e));
                existingConfig = {};
            }
        }
        return existingConfig;
    };
    if (config !== undefined) {
        const incoming = typeof config === "string" ? JSON.parse(config) : config;
        mergedConfig = mergeSecrets(incoming, readExisting()) as Record<string, unknown>;
        configString = JSON.stringify(encryptConfig(mergedConfig));
    }

    // The logins after the edit, which the checks below lay over the config like a run does.
    const logins = {
        primaryCredentialId: primaryCredentialId !== undefined ? primaryCredentialId ?? null : existing.primaryCredentialId ?? null,
        sshCredentialId: sshCredentialId !== undefined ? sshCredentialId ?? null : existing.sshCredentialId ?? null,
    };
    const loginsChange = logins.primaryCredentialId !== (existing.primaryCredentialId ?? null)
        || logins.sshCredentialId !== (existing.sshCredentialId ?? null);
    // A config or a login can change what a connection reaches, a name or the metadata cannot.
    const placeMayMove = config !== undefined || loginsChange;
    const roleChanges = isStorageRole(storageRole) && storageRole !== existing.storageRole;
    const shared = existing.type === "storage" && (roleChanges || placeMayMove) ? await isShared(id) : false;

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
    if (roleChanges) {
        // The customers of a shared destination keep their backups in it, which a directory
        // source would hand to its tenant to read as folders.
        if (shared) throw new ValidationError(SHARED_ROLE_STAYS, { field: "storageRole" });
        // A connection of the other role is one the platform may not let the tenant add itself.
        await assertMayAdd(existing.type, storageRole as StorageRole);
        await assertRoleFree(id, storageRole as StorageRole);
    }

    // The same gate as on create, also for an edit that only switches the mode of the connection.
    if (placeMayMove) {
        await assertMayReachHost(existing.adapterId, () => mergedConfig ?? readExisting(), logins);
    }
    if (shared && placeMayMove) {
        const before = await locationOf(existing.adapterId, readExisting(), existing.primaryCredentialId ?? null, existing.sshCredentialId ?? null);
        const after = await locationOf(existing.adapterId, mergedConfig ?? readExisting(), logins.primaryCredentialId, logins.sshCredentialId);
        if (movedLocationKeys(before, after).length > 0) throw new ValidationError(SHARED_PLACE_STAYS, { field: "config" });
    }
    // Nor may it move to where another destination of the tenant shared with customers keeps their backups.
    if (existing.type === "storage" && placeMayMove) {
        await assertOffSharedPlaces(existing.adapterId, mergedConfig ?? readExisting(), logins, id);
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
        mergedConfig !== undefined ? { before: readExisting(), after: mergedConfig } : undefined
    );
    return { adapter, previousName: existing.name, changes };
}

/**
 * A role change drops the connection out of every list its old role appeared in, so it is
 * refused while a job still depends on that role rather than breaking the job. The jobs of every
 * tenant count, since a destination may have been shared, but only those of the own tenant are
 * named.
 */
async function assertRoleFree(id: string, storageRole: StorageRole): Promise<void> {
    const tenantId = await currentTenantId();
    if (storageRole === STORAGE_ROLES.SOURCE) {
        const linked = await runAsSystem(() => prisma.jobDestination.findMany({ where: { configId: id }, select: { job: { select: { name: true, tenantId: true } } } }));
        if (linked.length > 0) {
            throw new ValidationError(
                `Cannot turn this into a directory source: it is used as a destination in ${jobsNamed(linked.map((d) => d.job), tenantId)}.`,
                { field: "storageRole" }
            );
        }
        return;
    }
    const linked = await runAsSystem(() => prisma.jobSource.findMany({ where: { configId: id }, select: { job: { select: { name: true, tenantId: true } } } }));
    if (linked.length > 0) {
        throw new ValidationError(
            `Cannot turn this into a destination: it is used as a directory source in ${jobsNamed(linked.map((s) => s.job), tenantId)}.`,
            { field: "storageRole" }
        );
    }
}

/** The jobs in the way: those of the own tenant by name, those of others only counted. All by name outside a tenant. */
function jobsNamed(jobs: { name: string; tenantId?: string | null }[], tenantId: string | null): string {
    const own = jobs.filter((job) => !tenantId || !job.tenantId || job.tenantId === tenantId).map((job) => job.name);
    const others = jobs.length - own.length;
    return [...own, ...(others > 0 ? [`${others} ${others === 1 ? "job" : "jobs"} of other tenants`] : [])].join(", ");
}

/** A config with its credential profiles laid over it, as a run sees it. The config alone when a profile cannot be read. */
async function locationOf(adapterId: string, config: Record<string, unknown>, primaryCredentialId: string | null, sshCredentialId: string | null): Promise<Record<string, unknown>> {
    if (!primaryCredentialId && !sshCredentialId) return config;
    try {
        return await layLoginsOver(adapterId, { ...config }, primaryCredentialId, sshCredentialId);
    } catch (e) {
        log.warn("Failed to read a login of a shared destination, its config alone is compared", { adapterId }, wrapError(e));
        return config;
    }
}

/** The keys that say where the files are and differ between two configs. A missing value and an empty one are the same. */
export function movedLocationKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
    const plain = (value: unknown) => (value === undefined || value === null ? "" : String(value).trim());
    return LOCATION_KEYS.filter((key) => plain(before[key]) !== plain(after[key]));
}

/** A refusal of the role or the shadow copy check as the error the API answers with `success: false`. Anything else stays as it is. */
function asUnsupported(error: unknown): unknown {
    return error instanceof ValidationError ? new UnsupportedSettingError(error.message, { field: error.field, cause: error }) : error;
}
