import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { toAdapterListItem } from "@/lib/adapters/dto";
import { headers } from "next/headers";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getAuthContext, checkPermissionWithContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { TRASH_ADMIN_PERMISSION, getWritePermissionForAdapterType } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { permissionRefusal } from "@/lib/server/permission-refusal";
import { connectionNotFound, seesConnectionType } from "@/lib/server/connection-access";
import { configBackupTargetResponse, savedLoginRefusal } from "@/lib/server/config-backup-target-guard";
import { wrapError, ValidationError, NotFoundError, ConflictError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { deleteAdapter } from "@/services/adapters/adapter-service";
import { getAdapterType, getConnectionLoginIds } from "@/services/adapters/adapter-list";
import { updateAdapter, UnsupportedSettingError } from "@/services/adapters/adapter-update";
import { PERMANENT_DELETE_REFUSED, permanentlyFrom } from "@/lib/core/delete-mode";

registerAdapters();

const log = logger.child({ route: "adapters/[id]" });

export async function DELETE(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
    }

    const params = await props.params;
    try {
        // RBAC: Check permission based on adapter type, a missing one and one the caller may not read alike.
        const type = await getAdapterType(params.id);
        if (!seesConnectionType(ctx, type)) return connectionNotFound();
        checkPermissionWithContext(ctx, getWritePermissionForAdapterType(type));
        // The destination of the configuration backup goes only with a platform admin.
        const locked = await configBackupTargetResponse(ctx, { connectionIds: [params.id] });
        if (locked) return locked;

        // Into Recently deleted, unless `?permanently=true`, which needs the right to change the settings too.
        const permanently = permanentlyFrom(req.nextUrl.searchParams);
        if (permanently && !hasPermissionWithContext(ctx, TRASH_ADMIN_PERMISSION)) {
            return NextResponse.json({ success: false, error: PERMANENT_DELETE_REFUSED }, { status: 403 });
        }
        const deletedAdapter = await deleteAdapter(params.id, { permanently, by: ctx.userId });

        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.ADAPTER,
            { name: deletedAdapter.name, ...(permanently ? { permanently: true } : {}) },
            params.id
        );

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const refused = permissionRefusal(error);
        if (refused) return refused;
        // Still referenced is the caller's problem to fix, not a server fault.
        if (error instanceof ConflictError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        }
        log.error("Delete adapter error", { adapterId: params.id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The connection could not be deleted." }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
    }

    const params = await props.params;
    try {
        // RBAC: Check permission based on adapter type, a missing one and one the caller may not read alike.
        const type = await getAdapterType(params.id);
        if (!seesConnectionType(ctx, type)) return connectionNotFound();
        checkPermissionWithContext(ctx, getWritePermissionForAdapterType(type));
        // Pointed elsewhere or given another login, the next configuration backup would go there.
        const locked = await configBackupTargetResponse(ctx, { connectionIds: [params.id] });
        if (locked) return locked;

        const body = await req.json();
        const { name, config, metadata, primaryCredentialId, sshCredentialId, storageRole } = body;
        // Nor does another connection sign in with the logins of that destination, the ones the
        // request names and, for a new config, the ones it keeps.
        const kept = config !== undefined ? await getConnectionLoginIds(params.id) : [];
        const loginLocked = await savedLoginRefusal(ctx, primaryCredentialId, sshCredentialId, ...kept);
        if (loginLocked) return loginLocked;

        let result;
        try {
            result = await updateAdapter(params.id, { name, config, metadata, primaryCredentialId, sshCredentialId, storageRole });
        } catch (e) {
            // A role or shadow copies the adapter cannot serve have always come with success: false, the rest without.
            if (e instanceof UnsupportedSettingError) return NextResponse.json({ success: false, error: e.message }, { status: 400 });
            if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
            if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
            if (e instanceof ConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
            throw e;
        }
        if (!result) {
            return NextResponse.json({ success: false, error: "Adapter not found" }, { status: 404 });
        }

        const { adapter, previousName, changes } = result;
        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.ADAPTER,
            {
                name: adapter.name,
                ...(previousName !== adapter.name ? { renamedFrom: previousName } : {}),
                changes,
            },
            adapter.id
        );

        return NextResponse.json(toAdapterListItem(adapter));
    } catch (error: unknown) {
        const refused = permissionRefusal(error);
        if (refused) return refused;
        log.error("Update adapter error", { adapterId: params.id }, wrapError(error));
        return NextResponse.json({ error: "Failed to update adapter" }, { status: 500 });
    }
}
