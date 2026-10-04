import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import * as credentialService from "@/services/auth/credential-service";
import { CREDENTIAL_TYPES, type CredentialType } from "@/lib/core/credentials";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ConflictError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ route: "credentials" });

const CreateCredentialSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    type: z.enum(CREDENTIAL_TYPES),
    description: z.string().max(500).nullish(),
    data: z.unknown(),
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
    log.error("Unexpected error in credentials route", {}, wrapError(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.READ);

        const typeParam = req.nextUrl.searchParams.get("type");
        const type =
            typeParam && (CREDENTIAL_TYPES as readonly string[]).includes(typeParam)
                ? (typeParam as CredentialType)
                : undefined;

        const includeCounts = req.nextUrl.searchParams.get("includeCounts") === "true";
        const profiles = includeCounts
            ? await credentialService.listCredentialProfilesWithCounts(type)
            : await credentialService.listCredentialProfiles(type);
        return NextResponse.json({ success: true, data: profiles });
    } catch (e) {
        return errorResponse(e);
    }
}

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.CREDENTIALS.WRITE);

        const body = await req.json();
        const parsed = CreateCredentialSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid request body", details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const { name, type, description, data } = parsed.data;
        const profile = await credentialService.createCredentialProfile(
            name,
            type,
            data,
            description ?? undefined
        );

        await auditService.logFor(
            ctx,
            AUDIT_ACTIONS.CREATE,
            AUDIT_RESOURCES.CREDENTIAL,
            { name, type },
            profile.id
        );

        return NextResponse.json({ success: true, data: profile }, { status: 201 });
    } catch (e) {
        return errorResponse(e);
    }
}
