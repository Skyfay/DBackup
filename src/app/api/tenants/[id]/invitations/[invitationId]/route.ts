import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { getAuthContext } from "@/lib/auth/access-control";
import { tenantRouteAccess } from "@/lib/auth/tenant-route-access";
import { NotFoundError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { INVITATION_GONE, revokeInvitationAs } from "@/services/tenant/invitation-admin";

const log = logger.child({ route: "tenants/[id]/invitations/[invitationId]" });

/**
 * DELETE /api/tenants/[id]/invitations/[invitationId]
 * Takes back a link of the tenant nobody used yet. For whoever manages the tenants and looks
 * after this one, and for a key or a session of the tenant itself with `users:write`.
 */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string; invitationId: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id, invitationId } = await props.params;
    try {
        const access = await tenantRouteAccess(ctx, id, true);
        if (access.kind === "refused") return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        const apiKeyId = ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null;
        await revokeInvitationAs({ id: ctx.userId, apiKeyId }, id, invitationId);
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        if (error instanceof NotFoundError) return NextResponse.json({ success: false, error: INVITATION_GONE }, { status: 404 });
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Revoking an invitation failed", { tenantId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The invitation could not be revoked" }, { status: 500 });
    }
}
