import { NextRequest, NextResponse } from "next/server";
import { isStorageRole } from "@/lib/core/storage-roles";
import prisma from "@/lib/prisma";
import { toAdapterListItem } from "@/lib/adapters/dto";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, ValidationError, NotFoundError, ConflictError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { getConnectionOverview } from "@/services/adapters/connection-overview";
import { createAdapter } from "@/services/adapters/adapter-create";

registerAdapters();

const log = logger.child({ route: "adapters" });

export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    // Storage adapters split into two exclusive roles. Callers that only care about one
    // (the Backups page, the Destinations page) pass it; the job form deliberately
    // omits it and splits the single response itself.
    const roleParam = searchParams.get("role")?.toUpperCase();
    const role = isStorageRole(roleParam) ? roleParam : undefined;

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
            where: {
                ...(type ? { type } : {}),
                ...(role && type === 'storage' ? { storageRole: role } : {}),
            },
            orderBy: { createdAt: 'desc' }
        });

        // Map every row through the safe DTO. `toAdapterListItem` redacts all
        // sensitive keys (deletes them, not blanks them) and reports `secretStatus`,
        // so a decrypted secret can never reach the client regardless of caller
        // permission level. See src/lib/adapters/dto.ts.
        const items = adapters.map(toAdapterListItem);

        // The connection tables ask for usage, last backup and health on top. Other callers
        // skip it, because it costs several aggregate queries.
        if (searchParams.get("overview") === "true") {
            const overview = await getConnectionOverview(items.map((item) => item.id));
            return NextResponse.json(items.map((item) => ({ ...item, overview: overview.get(item.id) ?? null })));
        }

        return NextResponse.json(items);
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
        const { name, type, adapterId, config, metadata, primaryCredentialId, sshCredentialId, storageRole } = body;

        // Permission Check
        if (type === 'database') {
            checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.WRITE);
        } else if (type === 'storage') {
            checkPermissionWithContext(ctx, PERMISSIONS.DESTINATIONS.WRITE);
        } else if (type === 'notification') {
            checkPermissionWithContext(ctx, PERMISSIONS.NOTIFICATIONS.WRITE);
        }

        let newAdapter;
        try {
            newAdapter = await createAdapter({ name, type, adapterId, config, metadata, primaryCredentialId, sshCredentialId, storageRole });
        } catch (e) {
            if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
            if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
            if (e instanceof ConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
            throw e;
        }

        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.CREATE,
            AUDIT_RESOURCES.ADAPTER,
            { name, type, adapterId },
            newAdapter.id
        );

        return NextResponse.json(toAdapterListItem(newAdapter), { status: 201 });
    } catch (error: unknown) {
        log.error("Create adapter error", {}, wrapError(error));
        return NextResponse.json({ error: getErrorMessage(error) || "Failed to create adapter" }, { status: 500 });
    }
}
