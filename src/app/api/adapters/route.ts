import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { encryptConfig, decryptConfig, stripSecrets } from "@/lib/crypto";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, ValidationError, NotFoundError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { validateCredentialAssignments } from "@/lib/adapters/credential-validation";

registerAdapters();

const log = logger.child({ route: "adapters" });

export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");

    try {
        if (type === 'database') {
            checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.VIEW);
        } else if (type === 'storage') {
            checkPermissionWithContext(ctx, PERMISSIONS.DESTINATIONS.READ);
        } else if (type === 'notification') {
             checkPermissionWithContext(ctx, PERMISSIONS.NOTIFICATIONS.READ);
        }
        // Security: Require type parameter to prevent leaking all adapter configs
        else if (!type) {
            return NextResponse.json(
                { error: "Type parameter is required (database, storage, or notification)" },
                { status: 400 }
            );
        }

        const adapters = await prisma.adapterConfig.findMany({
            where: type ? { type } : undefined,
            orderBy: { createdAt: 'desc' }
        });

        const decryptedAdapters = adapters.map(adapter => {
            try {
                // Parse the config JSON first
                const configObj = JSON.parse(adapter.config);
                // Decrypt sensitive fields
                const decryptedConfig = decryptConfig(configObj);
                // Return adapter with config object (or string depending on frontend expectation)
                // The frontend seems to expect objects if we look at similar code or just stringified
                // Actually the API previously returned the raw Prisma result where `config` is string.
                // However, the frontend likely JSON.parse() it.
                // Wait, Prisma returns `config` as string because schema says `String`.

                // If I modify the response here, I should make sure I am consistent.
                // If I return the string, I should stringify it back.

                return {
                    ...adapter,
                    config: JSON.stringify(stripSecrets(decryptedConfig))
                };
            } catch (e: unknown) {
                log.error("Failed to process config for adapter", { adapterId: adapter.id }, wrapError(e));
                return adapter; // Return as-is if error (fallback)
            }
        });

        return NextResponse.json(decryptedAdapters);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to fetch adapters";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { name, type, adapterId, config, metadata, primaryCredentialId, sshCredentialId } = body;

        // Permission Check
        if (type === 'database') {
            checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.WRITE);
        } else if (type === 'storage') {
            checkPermissionWithContext(ctx, PERMISSIONS.DESTINATIONS.WRITE);
        } else if (type === 'notification') {
            checkPermissionWithContext(ctx, PERMISSIONS.NOTIFICATIONS.WRITE);
        }

        // Basic validation
        if (!name || !type || !adapterId || !config) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Validate credential profile assignments (if provided)
        try {
            await validateCredentialAssignments(adapterId, primaryCredentialId ?? null, sshCredentialId ?? null);
        } catch (e) {
            if (e instanceof ValidationError) {
                return NextResponse.json({ error: e.message }, { status: 400 });
            }
            if (e instanceof NotFoundError) {
                return NextResponse.json({ error: e.message }, { status: 404 });
            }
            throw e;
        }

        // Check name uniqueness within the same type
        const existingByName = await prisma.adapterConfig.findFirst({
            where: { name, type },
        });
        if (existingByName) {
            return NextResponse.json({ error: `A ${type === 'database' ? 'source' : type === 'storage' ? 'destination' : 'notification'} with the name "${name}" already exists.` }, { status: 409 });
        }

        // Ensure config is object for encryption
        const configObj = typeof config === 'string' ? JSON.parse(config) : config;

        // Encrypt sensitive fields
        const encryptedConfig = encryptConfig(configObj);

        // Stringify for storage
        const configString = JSON.stringify(encryptedConfig);

        const newAdapter = await prisma.adapterConfig.create({
            data: {
                name,
                type,
                adapterId,
                config: configString,
                primaryCredentialId: primaryCredentialId ?? null,
                sshCredentialId: sshCredentialId ?? null,
                ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
            },
        });

        if (ctx) {
            await auditService.log(
                ctx.userId,
                AUDIT_ACTIONS.CREATE,
                AUDIT_RESOURCES.ADAPTER,
                { name, type, adapterId },
                newAdapter.id
            );
        }

        return NextResponse.json(newAdapter, { status: 201 });
    } catch (error: unknown) {
        log.error("Create adapter error", {}, wrapError(error));
        return NextResponse.json({ error: getErrorMessage(error) || "Failed to create adapter" }, { status: 500 });
    }
}
