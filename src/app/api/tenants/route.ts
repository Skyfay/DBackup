import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { TenantNameSchema } from "@/lib/tenant/tenant-schemas";
import { createTenantAs, routeActor, tenantsFor } from "@/services/tenant/tenant-admin";

const log = logger.child({ route: "tenants" });

const CreateSchema = z.object({
    name: TenantNameSchema,
    /** A tenant of the MSP whose servers, destinations and channels go to customers. */
    sharesWithCustomers: z.boolean().optional(),
});

/**
 * GET /api/tenants
 * The tenants the caller looks after with the fields of Platform > Tenants: every tenant for a
 * platform admin, the tenants of the platform group otherwise, also for the key of either, which
 * a key carries only when it was made in the home tenant.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.PLATFORM.TENANTS_READ);
        return NextResponse.json({ success: true, data: await tenantsFor(await routeActor(ctx)) });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Listing the tenants failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The tenants could not be read" }, { status: 500 });
    }
}

/**
 * POST /api/tenants
 * Creates a tenant with the built-in templates and groups, for a platform admin or someone whose
 * platform group reaches every tenant, since a group of some tenants would never reach the new one.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.PLATFORM.TENANTS_WRITE);
        const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
        const tenant = await createTenantAs(await routeActor(ctx), parsed.data.name, parsed.data.sharesWithCustomers ?? false);
        return NextResponse.json({ success: true, data: tenant }, { status: 201 });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Creating a tenant failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The tenant could not be created" }, { status: 500 });
    }
}
