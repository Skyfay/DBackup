import { NextRequest, NextResponse } from "next/server";
import { isStorageRole } from "@/lib/core/storage-roles";
import { toAdapterListItem } from "@/lib/adapters/dto";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { SEE_SHARING_PERMISSION } from "@/lib/tenant/sharing";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { permissionRefusal } from "@/lib/server/permission-refusal";
import { wrapError, getErrorMessage, ValidationError, NotFoundError, ConflictError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { createAdapter } from "@/services/adapters/adapter-create";
import { listAdapters } from "@/services/adapters/adapter-list";

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
        else {
            return NextResponse.json(
                { error: "Type parameter is required (database, storage, or notification)" },
                { status: 400 }
            );
        }

        // The servers of other tenants whose databases the tenant holds, which only the Connections
        // page asks for with `shared=true`. A tenant has to be open, All tenants lists none of them.
        // The newest backup of each database comes along for whoever may see, restore or download it.
        const sharedServers = type === "database" && searchParams.get("shared") === "true" && ctx.tenantId && !ctx.allTenants
            ? {
                  tenantId: ctx.tenantId,
                  backups: [PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.STORAGE.DOWNLOAD].some((permission) => hasPermissionWithContext(ctx, permission)),
              }
            : undefined;

        // Every row is the safe DTO, so a decrypted secret never reaches the client whatever the
        // caller may see. The connection tables ask for usage, last backup and health on top.
        const items = await listAdapters(type, {
            role,
            overview: searchParams.get("overview") === "true",
            shares: hasPermissionWithContext(ctx, SEE_SHARING_PERMISSION),
            sharedServers,
        });
        return NextResponse.json(items);
    } catch (error: unknown) {
        const refused = permissionRefusal(error);
        if (refused) return refused;
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
        } else {
            // A kind without a permission of its own is no connection, so nothing is created.
            return NextResponse.json({ success: false, error: "The type must be database, storage or notification" }, { status: 400 });
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
        const refused = permissionRefusal(error);
        if (refused) return refused;
        log.error("Create adapter error", {}, wrapError(error));
        return NextResponse.json({ error: getErrorMessage(error) || "Failed to create adapter" }, { status: 500 });
    }
}
