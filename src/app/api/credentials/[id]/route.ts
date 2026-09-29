import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import * as credentialService from "@/services/auth/credential-service";
import { credentialChanges, credentialName, credentialSnapshot } from "@/services/auth/credential-audit";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ConflictError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ route: "credentials/[id]" });

const UpdateCredentialSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    data: z.unknown().optional(),
});

function errorResponse(error: unknown): NextResponse {
    if (error instanceof ValidationError) {
        return NextResponse.json(
            { error: error.message, details: error.details },
            { status: 400 }
        );
    }
    if (error instanceof ConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof NotFoundError) {
        return NextResponse.json({ error: error.message }, { status: 404 });
    }
    log.error("Unexpected error in credentials/[id] route", {}, wrapError(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(
    _req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.READ);
        const profile = await credentialService.getCredentialProfile(id);
        return NextResponse.json({ success: true, data: profile });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function PUT(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.WRITE);

        const body = await req.json();
        const parsed = UpdateCredentialSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid request body", details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const before = await credentialSnapshot(id);
        const profile = await credentialService.updateCredentialProfile(id, parsed.data);

        // Secrets are compared, never written: a changed one is only marked as changed.
        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.CREDENTIAL,
            {
                name: profile.name,
                ...(before && before.name !== profile.name ? { renamedFrom: before.name } : {}),
                changes: credentialChanges(before, await credentialSnapshot(id)),
            },
            id
        );

        return NextResponse.json({ success: true, data: profile });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function DELETE(
    _req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.DELETE);

        // Read first, the profile is gone afterwards.
        const name = await credentialName(id);
        await credentialService.deleteCredentialProfile(id);

        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.CREDENTIAL,
            { name },
            id
        );

        return NextResponse.json({ success: true });
    } catch (e) {
        return errorResponse(e);
    }
}
