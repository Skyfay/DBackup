import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { getWritePermissionForAdapterType } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { permissionRefusal } from "@/lib/server/permission-refusal";
import { connectionNotFound, seesConnectionType } from "@/lib/server/connection-access";
import { storedSecretsRefusal } from "@/lib/server/config-backup-target-guard";
import { wrapError, ValidationError } from "@/lib/logging/errors";
import { registerAdapters } from "@/lib/adapters";
import { toAdapterListItem } from "@/lib/adapters/dto";
import { getAdapterType } from "@/services/adapters/adapter-list";
import { cloneAdapter } from "@/services/adapters/adapter-clone";

registerAdapters();

const log = logger.child({ route: "adapters/[id]/clone" });

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
    }

    const params = await props.params;
    try {
        // A missing connection and one the caller may not read answer alike, only then the write permission counts.
        const type = await getAdapterType(params.id);
        if (!seesConnectionType(ctx, type)) return connectionNotFound();
        checkPermissionWithContext(ctx, getWritePermissionForAdapterType(type));
        // A copy of the destination of the configuration backup keeps its logins in a connection
        // its guard does not know, which its owner then points at another host.
        const locked = await storedSecretsRefusal(ctx, params.id);
        if (locked) return locked;

        // Without a name the copy gets a free one, and without a role it keeps the original's.
        let body: { name?: string; role?: string } = {};
        try { body = await req.json(); } catch { /* no body is fine */ }

        let result;
        try {
            result = await cloneAdapter(params.id, { name: body.name, role: body.role });
        } catch (e) {
            if (e instanceof ValidationError) {
                return NextResponse.json({ success: false, error: e.message }, { status: 400 });
            }
            throw e;
        }
        if (!result) {
            return NextResponse.json({ success: false, error: "Adapter not found" }, { status: 404 });
        }

        const { clone, original } = result;
        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.CREATE,
            AUDIT_RESOURCES.ADAPTER,
            { name: clone.name, clonedFrom: original.id, clonedFromName: original.name },
            clone.id
        );

        return NextResponse.json(toAdapterListItem(clone), { status: 201 });
    } catch (error: unknown) {
        const refused = permissionRefusal(error);
        if (refused) return refused;
        log.error("Clone adapter error", { adapterId: params.id }, wrapError(error));
        return NextResponse.json({
            success: false,
            error: "The connection could not be copied."
        }, { status: 500 });
    }
}
