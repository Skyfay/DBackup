import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext, type AuthContext } from "@/lib/auth/access-control";
import { tenantRouteAccess } from "@/lib/auth/tenant-route-access";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { setMemberAs, setOwnTenantMemberAs, tenantCallerOf } from "@/services/tenant/member-admin";

const log = logger.child({ route: "tenants/[id]/members/[userId]" });

const GroupSchema = z.object({ groupId: z.string().min(1).max(200) });

type Params = { params: Promise<{ id: string; userId: string }> };

/** Gives the member a group, or takes them out of the tenant with null, through the way the caller may. */
async function setGroup(ctx: AuthContext, tenantId: string, userId: string, groupId: string | null, parse?: () => Promise<string | null>) {
    const access = await tenantRouteAccess(ctx, tenantId, true);
    if (access.kind === "refused") return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    const group = parse ? await parse() : groupId;
    if (parse && group === null) return NextResponse.json({ success: false, error: "Name the group, groupId." }, { status: 400 });
    if (access.kind === "platform") await setMemberAs(access.actor, tenantId, userId, group);
    else await setOwnTenantMemberAs(tenantCallerOf(ctx), userId, group);
    return NextResponse.json({ success: true });
}

/**
 * PATCH /api/tenants/[id]/members/[userId]
 * Gives a member of the tenant another group, with the rules of Add member: nobody gives or takes
 * a group that may do more than they may in that tenant, nor changes their own membership.
 */
export async function PATCH(req: NextRequest, props: Params) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id, userId } = await props.params;
    try {
        return await setGroup(ctx, id, userId, null, async () => {
            const parsed = GroupSchema.safeParse(await req.json().catch(() => null));
            return parsed.success ? parsed.data.groupId : null;
        });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Changing the group of a member failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The member could not be changed" }, { status: 500 });
    }
}

/**
 * DELETE /api/tenants/[id]/members/[userId]
 * Takes an account out of the tenant. The account stays, with its other tenants.
 */
export async function DELETE(_req: NextRequest, props: Params) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id, userId } = await props.params;
    try {
        return await setGroup(ctx, id, userId, null);
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Removing a member failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The member could not be removed" }, { status: 500 });
    }
}
