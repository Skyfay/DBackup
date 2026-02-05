import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { encryptConfig, decryptConfig } from "@/lib/crypto";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logger";
import { wrapError, getErrorMessage } from "@/lib/errors";

const log = logger.child({ route: "adapters" });

export async function GET(req: NextRequest) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");

    try {
        if (type === 'database') {
            await checkPermission(PERMISSIONS.SOURCES.READ);
        } else if (type === 'storage') {
            await checkPermission(PERMISSIONS.DESTINATIONS.READ);
        } else if (type === 'notification') {
             await checkPermission(PERMISSIONS.NOTIFICATIONS.READ);
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
                    config: JSON.stringify(decryptedConfig)
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
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { name, type, adapterId, config } = body;

        // Permission Check
        if (type === 'database') {
            await checkPermission(PERMISSIONS.SOURCES.WRITE);
        } else if (type === 'storage') {
            await checkPermission(PERMISSIONS.DESTINATIONS.WRITE);
        } else if (type === 'notification') {
            await checkPermission(PERMISSIONS.NOTIFICATIONS.WRITE);
        }

        // Basic validation
        if (!name || !type || !adapterId || !config) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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
            },
        });

        if (session.user) {
            await auditService.log(
                session.user.id,
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
