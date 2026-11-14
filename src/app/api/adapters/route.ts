import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
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
import { savedLoginRefusal } from "@/lib/server/config-backup-target-guard";
import { wrapError, ValidationError, NotFoundError, ConflictError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { createAdapter } from "@/services/adapters/adapter-create";
import { listAdapters } from "@/services/adapters/adapter-list";
import { platformGroupService } from "@/services/user/platform-group-service";

registerAdapters();

const log = logger.child({ route: "adapters" });

export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
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
        const shares = hasPermissionWithContext(ctx, SEE_SHARING_PERMISSION);
        const items = await listAdapters(type, {
            role,
            overview: searchParams.get("overview") === "true",
            shares,
            // The tenants a share names, within the reach of the platform group of the viewer.
            shareReach: shares ? await platformGroupService.reachOf(ctx.userId) : undefined,
            sharedServers,
        });
        return NextResponse.json(items);
    } catch (error: unknown) {
        const refused = permissionRefusal(error);
        if (refused) return refused;
        log.error("Listing connections failed", {}, wrapError(error));
        return NextResponse.json({ error: "The connections could not be loaded. The log of DBackup has the details." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
    }

    try {
        const body = await req.json();
        const { name, type, adapterId, config, metadata, primaryCredentialId, sshCredentialId, storageRole, sshHostKey } = body;

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
        // A new connection never signs in with the logins of the destination of the configuration backup.
        const locked = await savedLoginRefusal(ctx, primaryCredentialId, sshCredentialId);
        if (locked) return locked;

        let newAdapter;
        try {
            newAdapter = await createAdapter({ name, type, adapterId, config, metadata, primaryCredentialId, sshCredentialId, storageRole, sshHostKey });
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
        return NextResponse.json({ error: "The connection could not be created. The log of DBackup has the details." }, { status: 500 });
    }
}
