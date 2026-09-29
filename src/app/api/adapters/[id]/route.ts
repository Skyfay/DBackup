import { NextRequest, NextResponse } from "next/server";
import { STORAGE_ROLES, isStorageRole, type StorageRole } from "@/lib/core/storage-roles";
import { validateSnapshotConfig } from "@/lib/adapters/snapshot-validation";
import { validateStorageRole } from "@/lib/adapters/role-validation";
import prisma from "@/lib/prisma";
import { encryptConfig, decryptConfig, mergeSecrets } from "@/lib/crypto";
import { toAdapterListItem } from "@/lib/adapters/dto";
import { headers } from "next/headers";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { getWritePermissionForAdapterType } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, ValidationError, NotFoundError, ConflictError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { validateCredentialAssignments } from "@/lib/adapters/credential-validation";
import { deleteAdapter } from "@/services/adapters/adapter-service";
import { connectionChanges } from "@/services/adapters/adapter-audit";

registerAdapters();

const log = logger.child({ route: "adapters/[id]" });

export async function DELETE(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        // RBAC: Check permission based on adapter type
        const adapter = await prisma.adapterConfig.findUnique({
            where: { id: params.id },
            select: { type: true }
        });
        if (!adapter) {
            return NextResponse.json({ success: false, error: "Adapter not found" }, { status: 404 });
        }
        checkPermissionWithContext(ctx, getWritePermissionForAdapterType(adapter.type));

        const deletedAdapter = await deleteAdapter(params.id);

        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.ADAPTER,
            { name: deletedAdapter.name },
            params.id
        );

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        // Still referenced is the caller's problem to fix, not a server fault.
        if (error instanceof ConflictError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        }
        log.error("Delete adapter error", { adapterId: params.id }, wrapError(error));
        return NextResponse.json({
            success: false,
            error: getErrorMessage(error) || "Failed to delete adapter"
        }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        // RBAC: Check permission based on adapter type
        const existingAdapter = await prisma.adapterConfig.findUnique({
            where: { id: params.id },
            select: {
                type: true, adapterId: true, lastError: true, config: true, storageRole: true,
                // What the audit entry compares the edit with.
                name: true, primaryCredentialId: true, sshCredentialId: true, metadata: true,
            }
        });
        if (!existingAdapter) {
            return NextResponse.json({ success: false, error: "Adapter not found" }, { status: 404 });
        }
        checkPermissionWithContext(ctx, getWritePermissionForAdapterType(existingAdapter.type));

        const body = await req.json();
        const { name, config, metadata, primaryCredentialId, sshCredentialId, storageRole } = body;

        // Validate credential profile assignments (if provided)
        if (primaryCredentialId !== undefined || sshCredentialId !== undefined) {
            try {
                await validateCredentialAssignments(
                    existingAdapter.adapterId,
                    primaryCredentialId ?? null,
                    sshCredentialId ?? null
                );
            } catch (e) {
                if (e instanceof ValidationError) {
                    return NextResponse.json({ error: e.message }, { status: 400 });
                }
                if (e instanceof NotFoundError) {
                    return NextResponse.json({ error: e.message }, { status: 404 });
                }
                throw e;
            }
        }

        // Check name uniqueness within the same type (excluding current adapter)
        if (name) {
            const existingByName = await prisma.adapterConfig.findFirst({
                where: { name, type: existingAdapter.type, id: { not: params.id } },
            });
            if (existingByName) {
                const typeLabel = existingAdapter.type === 'database' ? 'source' : existingAdapter.type === 'storage' ? 'destination' : 'notification';
                return NextResponse.json({ error: `A ${typeLabel} with the name "${name}" already exists.` }, { status: 409 });
            }
        }

        // Build the encrypted config string only when a config payload was supplied.
        // Secret-preserving merge: the API returns redacted secrets, so an edit
        // round-trip submits empty secret fields. Re-fill them from the existing
        // (decrypted) config before re-encrypting so we never clobber a real
        // secret with an encrypted empty string (data-loss bug).
        let configString: string | undefined;
        // Kept in scope for the snapshot check below, which has to probe with the real
        // secrets rather than the redacted ones the form submits.
        let mergedPlainConfig: Record<string, unknown> | undefined;
        // The config as it was, which the audit entry compares the merged one with.
        let existingDecrypted: unknown = {};
        if (config !== undefined) {
            const incomingConfig = typeof config === 'string' ? JSON.parse(config) : config;
            try {
                existingDecrypted = decryptConfig(JSON.parse(existingAdapter.config));
            } catch (e) {
                log.warn("Failed to decrypt existing config during update; secret merge skipped", { adapterId: params.id }, wrapError(e));
            }
            const mergedConfig = mergeSecrets(incomingConfig, existingDecrypted);
            mergedPlainConfig = mergedConfig as Record<string, unknown>;
            configString = JSON.stringify(encryptConfig(mergedConfig));
        }

        // A role change drops the adapter out of every list its old role appeared in, so
        // refuse it while a job still depends on that role rather than breaking the job.
        if (storageRole !== undefined && !isStorageRole(storageRole)) {
            return NextResponse.json({ error: "Invalid storage role" }, { status: 400 });
        }
        // Checked before the in-use checks below, because an adapter that cannot serve the
        // requested role at all should say so plainly rather than explain which jobs are in
        // the way of a move that was never possible.
        if (isStorageRole(storageRole) && existingAdapter.type === "storage") {
            try {
                validateStorageRole(existingAdapter.adapterId, storageRole);
            } catch (e) {
                if (e instanceof ValidationError) {
                    return NextResponse.json({ success: false, error: e.message }, { status: 400 });
                }
                throw e;
            }
        }
        if (isStorageRole(storageRole) && storageRole !== existingAdapter.storageRole) {
            if (storageRole === STORAGE_ROLES.SOURCE) {
                const linkedDestinations = await prisma.jobDestination.findMany({
                    where: { configId: params.id },
                    select: { job: { select: { name: true } } },
                });
                if (linkedDestinations.length > 0) {
                    return NextResponse.json({
                        error: `Cannot turn this into a directory source: it is used as a destination in ${linkedDestinations.map(d => d.job.name).join(', ')}.`
                    }, { status: 400 });
                }
            } else {
                const linkedSources = await prisma.jobSource.findMany({
                    where: { configId: params.id },
                    select: { job: { select: { name: true } } },
                });
                if (linkedSources.length > 0) {
                    return NextResponse.json({
                        error: `Cannot turn this into a destination: it is used as a directory source in ${linkedSources.map(s => s.job.name).join(', ')}.`
                    }, { status: 400 });
                }
            }
        }

        // Same gate as on create: the config that ends up stored has to be one the server
        // can honour, whichever endpoint wrote it.
        if (mergedPlainConfig !== undefined) {
            try {
                const effectiveRole = isStorageRole(storageRole) ? storageRole : (existingAdapter.storageRole as StorageRole);
                const configForCheck = mergedPlainConfig;
                await validateSnapshotConfig(
                    existingAdapter.adapterId,
                    configForCheck,
                    effectiveRole,
                    primaryCredentialId ?? null,
                    sshCredentialId ?? null
                );
            } catch (e) {
                if (e instanceof ValidationError) {
                    return NextResponse.json({ success: false, error: e.message }, { status: 400 });
                }
                throw e;
            }
        }

        const updatedAdapter = await prisma.adapterConfig.update({
            where: { id: params.id },
            data: {
                name,
                ...(configString !== undefined ? { config: configString } : {}),
                ...(primaryCredentialId !== undefined ? { primaryCredentialId: primaryCredentialId ?? null } : {}),
                ...(sshCredentialId !== undefined ? { sshCredentialId: sshCredentialId ?? null } : {}),
                ...(metadata !== undefined ? { metadata: JSON.stringify(metadata) } : {}),
                ...(isStorageRole(storageRole) ? { storageRole } : {}),
                // Clear the "No credential profile assigned" OFFLINE/DEGRADED flag when a profile is now assigned.
                ...(primaryCredentialId && existingAdapter.lastError === "No credential profile assigned"
                    ? { lastStatus: "ONLINE", lastError: null, consecutiveFailures: 0 }
                    : {}),
            }
        });

        // Secrets are compared, never written: a changed one is only marked as changed.
        const changes = await connectionChanges(
            existingAdapter.type,
            existingAdapter,
            updatedAdapter,
            mergedPlainConfig !== undefined ? { before: existingDecrypted, after: mergedPlainConfig } : undefined
        );
        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.ADAPTER,
            {
                name: updatedAdapter.name,
                ...(existingAdapter.name !== updatedAdapter.name ? { renamedFrom: existingAdapter.name } : {}),
                changes,
            },
            updatedAdapter.id
        );

        return NextResponse.json(toAdapterListItem(updatedAdapter));
    } catch (_error) {
        return NextResponse.json({ error: "Failed to update adapter" }, { status: 500 });
    }
}
