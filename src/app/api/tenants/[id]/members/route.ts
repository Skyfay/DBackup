import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/access-control";
import { tenantRouteAccess } from "@/lib/auth/tenant-route-access";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { membersFor, setMemberAs, setOwnTenantMemberAs, tenantCallerOf } from "@/services/tenant/member-admin";
import { membershipService } from "@/services/tenant/membership-service";

const log = logger.child({ route: "tenants/[id]/members" });

const AddSchema = z.object({
    userId: z.string().min(1).max(200),
    /** The group of the tenant the account gets there. */
    groupId: z.string().min(1).max(200),
});

/**
 * GET /api/tenants/[id]/members
 * The members of a tenant with their group. Whoever manages the tenants and looks after this one
 * also gets the accounts they may add and the groups they may give, like Add member on
 * Platform > Tenants. A key or a session of the tenant itself with `users:read` gets the members.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await props.params;
    try {
        const access = await tenantRouteAccess(ctx, id, false);
        if (access.kind === "refused") return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        if (access.kind === "tenant") return NextResponse.json({ success: true, data: { members: await membershipService.members(id) } });
        // Add member offers its accounts and groups only to whoever may change the members.
        const changes = (await tenantRouteAccess(ctx, id, true)).kind === "platform";
        return NextResponse.json({ success: true, data: await membersFor(access.actor, id, changes) });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Reading the members of a tenant failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The members could not be read" }, { status: 500 });
    }
}

/**
 * POST /api/tenants/[id]/members
 * Adds an existing account to a tenant with a group, or gives a member another group. Whoever
 * manages the tenants adds any account they see. A key or a session of the tenant itself with
 * `users:write` gives a group only to the people of its tenant, others join by an invitation.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await props.params;
    try {
        const access = await tenantRouteAccess(ctx, id, true);
        if (access.kind === "refused") return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        const parsed = AddSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

        if (access.kind === "platform") await setMemberAs(access.actor, id, parsed.data.userId, parsed.data.groupId);
        else await setOwnTenantMemberAs(tenantCallerOf(ctx), parsed.data.userId, parsed.data.groupId);
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Adding a member failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The member could not be added" }, { status: 500 });
    }
}
