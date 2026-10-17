import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { checkPermissionWithContext, getAuthContext, type AuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { NotFoundError, PermissionError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { TENANT_SETTINGS_AREA } from "@/services/tenant/tenant-settings-audit";
import { tenantService } from "@/services/tenant/tenant-service";
import { findTenantLogo, mayViewTenantLogo, removeTenantLogo, saveTenantLogo, TENANT_LOGO_MAX_BYTES } from "@/services/tenant/tenant-logo-service";

const log = logger.child({ route: "tenants/[id]/logo" });

const FIELD = "Logo";
const TOO_LARGE = "The logo is larger than 1 MB.";

/** The room a form takes beside the file, its boundaries and headers, so a body above it holds a file too large. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/** The types an upload is stored with, read from its bytes. A stored row of any other type is never served. */
const SERVED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * The logo of a tenant, for its people and for platform admins, who see every tenant. Anyone else
 * gets the answer of a tenant without a logo. Its type was read from its bytes when it was stored.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return new NextResponse(null, { status: 401 });

    const { id } = await params;
    const logo = (await mayViewTenantLogo(ctx, id)) ? await findTenantLogo(id) : null;
    if (!logo || !SERVED_TYPES.has(logo.mimeType)) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(logo.data), {
        headers: {
            "Content-Type": logo.mimeType,
            "Content-Length": String(logo.data.length),
            // The address carries the time of the logo in `?v=`, so a new logo gets a new address.
            "Cache-Control": req.nextUrl.searchParams.has("v") ? "private, max-age=31536000, immutable" : "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    });
}

/**
 * The tenant a change of the logo may touch: the one the request acts in, with the right to change
 * its settings. A logo of another tenant is changed from inside that tenant.
 */
function guardChange(ctx: AuthContext, tenantId: string): NextResponse | null {
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.TENANT_SETTINGS.WRITE);
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        throw error;
    }
    if (ctx.tenantId !== tenantId) return NextResponse.json({ success: false, error: "Open the tenant to change its logo." }, { status: 403 });
    return null;
}

/**
 * A new logo of the tenant the request acts in, `file` in a form, in place of the one before. A
 * route rather than a Server Action, like the picture of a person, for the size of a file.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const refused = guardChange(ctx, id);
    if (refused) return refused;
    // Refused before the form is read, which would hold the whole body in memory.
    if (Number(req.headers.get("content-length") ?? 0) > TENANT_LOGO_MAX_BYTES + FORM_OVERHEAD_BYTES) {
        return NextResponse.json({ success: false, error: TOO_LARGE }, { status: 413 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "Pick a picture to upload." }, { status: 400 });
    if (file.size > TENANT_LOGO_MAX_BYTES) return NextResponse.json({ success: false, error: TOO_LARGE }, { status: 400 });

    try {
        const tenant = await tenantService.find(id);
        if (!tenant) return NextResponse.json({ success: false, error: "The tenant no longer exists." }, { status: 404 });
        const saved = await saveTenantLogo(id, new Uint8Array(await file.arrayBuffer()));
        await auditService.logFor(ctx, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, {
            name: tenant.name,
            area: TENANT_SETTINGS_AREA,
            changes: [{ field: FIELD, from: saved.replaced ? "A logo" : null, to: "A new logo" }],
        }, id);
        revalidatePath("/dashboard", "layout");
        return NextResponse.json({ success: true, data: { url: saved.url } });
    } catch (error: unknown) {
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        if (error instanceof NotFoundError) return NextResponse.json({ success: false, error: "The tenant no longer exists." }, { status: 404 });
        log.error("Saving a tenant logo failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The logo could not be saved." }, { status: 500 });
    }
}

/** Removes the logo of the tenant the request acts in, which shows its initials again. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const refused = guardChange(ctx, id);
    if (refused) return refused;

    try {
        const tenant = await tenantService.find(id);
        if (!tenant) return NextResponse.json({ success: false, error: "The tenant no longer exists." }, { status: 404 });
        if (await removeTenantLogo(id)) {
            await auditService.logFor(ctx, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, {
                name: tenant.name,
                area: TENANT_SETTINGS_AREA,
                changes: [{ field: FIELD, from: "A logo", to: null }],
            }, id);
            revalidatePath("/dashboard", "layout");
        }
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        log.error("Removing a tenant logo failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The logo could not be removed." }, { status: 500 });
    }
}
