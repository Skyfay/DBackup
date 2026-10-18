import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { refusalStatus, serviceRefusal } from "@/lib/server/permission-refusal";
import { AllowancesSchema, NetworkSchema, OnDemandPerDaySchema, TenantNameSchema } from "@/lib/tenant/tenant-schemas";
import {
    deleteTenantAs, renameTenantAs, routeActor, setTenantAllowancesAs, setTenantNetworkAs, setTenantOnDemandAs, setTenantSharingAs, tenantFor, TenantNotEmptyError,
} from "@/services/tenant/tenant-admin";

const log = logger.child({ route: "tenants/[id]" });

/** The settings of the Edit dialog of a tenant, any of them, saved in this order. */
const PatchSchema = z.object({
    name: TenantNameSchema.optional(),
    sharesWithCustomers: z.boolean().optional(),
    allowances: AllowancesSchema.optional(),
    onDemandPerDay: OnDemandPerDaySchema.optional(),
    network: NetworkSchema.optional(),
}).strict();

type PatchField = keyof z.infer<typeof PatchSchema>;

/**
 * GET /api/tenants/[id]
 * One tenant the caller looks after, with the fields of Platform > Tenants. A tenant beyond the
 * platform group of the caller reads as gone.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await props.params;
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.PLATFORM.TENANTS_READ);
        return NextResponse.json({ success: true, data: await tenantFor(await routeActor(ctx), id) });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Reading a tenant failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The tenant could not be read" }, { status: 500 });
    }
}

/**
 * PATCH /api/tenants/[id]
 * Changes what the Edit dialog of a tenant changes: its name, whether it shares with customers,
 * what it adds itself, its backups on demand and its local network. Each field is saved on its
 * own, in the order of the schema, with the refusals of the dialog. The first refusal stops, and
 * `saved` names the fields saved before it.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await props.params;
    const saved: PatchField[] = [];
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.PLATFORM.TENANTS_WRITE);
        const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
        const patch = parsed.data;
        if (Object.values(patch).every((value) => value === undefined)) return NextResponse.json({ success: false, error: "Name at least one setting to change." }, { status: 400 });

        const actor = await routeActor(ctx);
        // Whoever cannot see the tenant learns nothing of it, whatever they send.
        await tenantFor(actor, id);
        if (patch.name !== undefined) {
            await renameTenantAs(actor, id, patch.name);
            saved.push("name");
        }
        if (patch.sharesWithCustomers !== undefined) {
            await setTenantSharingAs(actor, id, patch.sharesWithCustomers);
            saved.push("sharesWithCustomers");
        }
        if (patch.allowances !== undefined) {
            await setTenantAllowancesAs(actor, id, patch.allowances);
            saved.push("allowances");
        }
        if (patch.onDemandPerDay !== undefined) {
            await setTenantOnDemandAs(actor, id, patch.onDemandPerDay);
            saved.push("onDemandPerDay");
        }
        if (patch.network !== undefined) {
            await setTenantNetworkAs(actor, id, patch.network);
            saved.push("network");
        }
        return NextResponse.json({ success: true, data: { saved, tenant: await tenantFor(actor, id) } });
    } catch (error: unknown) {
        const status = refusalStatus(error);
        if (status) return NextResponse.json({ success: false, error: (error as Error).message, data: { saved } }, { status });
        log.error("Changing a tenant failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The tenant could not be changed", data: { saved } }, { status: 500 });
    }
}

/**
 * DELETE /api/tenants/[id]
 * Deletes a tenant with everything it holds, like Delete on Platform > Tenants. The backups at its
 * destinations stay, and so do the accounts, which lose their membership there. A tenant that holds
 * anything needs `?confirmed=true`, and the answer without it lists what would go.
 */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await props.params;
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.PLATFORM.TENANTS_WRITE);
        const confirmed = req.nextUrl.searchParams.get("confirmed") === "true";
        return NextResponse.json({ success: true, data: await deleteTenantAs(await routeActor(ctx), id, confirmed) });
    } catch (error: unknown) {
        if (error instanceof TenantNotEmptyError) return NextResponse.json({ success: false, error: error.message, data: { contents: error.contents } }, { status: 409 });
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Deleting a tenant failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The tenant could not be deleted" }, { status: 500 });
    }
}
