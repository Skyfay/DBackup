import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { getAuthContext } from "@/lib/auth/access-control";
import { tenantRouteAccess } from "@/lib/auth/tenant-route-access";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { createInvitationAs, invitationsOf, InviteSchema } from "@/services/tenant/invitation-admin";
import { actorIn } from "@/services/tenant/member-admin";

const log = logger.child({ route: "tenants/[id]/invitations" });

/**
 * GET /api/tenants/[id]/invitations
 * The open links of a tenant, newest first, never a token. For whoever manages the tenants and
 * looks after this one, and for a key or a session of the tenant itself with `users:read`.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await props.params;
    try {
        const access = await tenantRouteAccess(ctx, id, false);
        if (access.kind === "refused") return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        return NextResponse.json({ success: true, data: await invitationsOf(id) });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Reading the invitations of a tenant failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The invitations could not be read" }, { status: 500 });
    }
}

/**
 * POST /api/tenants/[id]/invitations
 * Makes a link that adds someone to the tenant with a group, working for 1 to 30 days. The token
 * comes back once, only its hash stays. Nobody hands out a group that may do more than they may in
 * that tenant: on the platform what the owner of the key may there, in the tenant itself what the
 * session or the key holds.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await props.params;
    try {
        const access = await tenantRouteAccess(ctx, id, true);
        if (access.kind === "refused") return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        const parsed = InviteSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

        const caps = access.kind === "platform" ? await actorIn(access.actor, id) : ctx;
        const apiKeyId = ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null;
        const invitation = await createInvitationAs({ id: ctx.userId, apiKeyId }, caps, id, parsed.data);
        // The link is the address of DBackup with `path`, which the browser of the person opens.
        return NextResponse.json({ success: true, data: invitation }, { status: 201 });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Creating an invitation failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The invitation could not be created" }, { status: 500 });
    }
}
