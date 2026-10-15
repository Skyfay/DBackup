import { NextRequest, NextResponse } from "next/server";
import { toAdapterListItem } from "@/lib/adapters/dto";
import { headers } from "next/headers";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getAuthContext, checkPermissionWithContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { TRASH_ADMIN_PERMISSION, getWritePermissionForAdapterType } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, ValidationError, NotFoundError, ConflictError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { deleteAdapter } from "@/services/adapters/adapter-service";
import { getAdapterType } from "@/services/adapters/adapter-list";
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
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        // RBAC: Check permission based on adapter type
        const type = await getAdapterType(params.id);
        if (!type) {
            return NextResponse.json({ success: false, error: "Adapter not found" }, { status: 404 });
        }
        checkPermissionWithContext(ctx, getWritePermissionForAdapterType(type));

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
        const type = await getAdapterType(params.id);
        if (!type) {
            return NextResponse.json({ success: false, error: "Adapter not found" }, { status: 404 });
        }
        checkPermissionWithContext(ctx, getWritePermissionForAdapterType(type));

        const body = await req.json();
        const { name, config, metadata, primaryCredentialId, sshCredentialId, storageRole } = body;

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
    } catch (_error) {
        return NextResponse.json({ error: "Failed to update adapter" }, { status: 500 });
    }
}
