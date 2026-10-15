import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { getWritePermissionForAdapterType } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, ValidationError } from "@/lib/logging/errors";
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
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        const type = await getAdapterType(params.id);
        if (!type) {
            return NextResponse.json({ success: false, error: "Adapter not found" }, { status: 404 });
        }

        checkPermissionWithContext(ctx, getWritePermissionForAdapterType(type));

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
        log.error("Clone adapter error", { adapterId: params.id }, wrapError(error));
        return NextResponse.json({
            success: false,
            error: getErrorMessage(error) || "Failed to clone adapter"
        }, { status: 500 });
    }
}
