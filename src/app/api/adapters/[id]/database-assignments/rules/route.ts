import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { checkAnyPermissionWithContext, checkPermissionWithContext, getAuthContext, tenantOf } from "@/lib/auth/access-control";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { SEE_SHARING_PERMISSION, SHARE_PERMISSION } from "@/lib/tenant/sharing";
import { AssignmentRuleSchema } from "@/lib/tenant/tenant-schemas";
import { logRuleAdded } from "@/services/tenant/assignment-audit";
import { databaseAssignmentService } from "@/services/tenant/database-assignments";
import { platformGroupService } from "@/services/user/platform-group-service";

const log = logger.child({ route: "adapters/[id]/database-assignments/rules" });

/**
 * GET /api/adapters/[id]/database-assignments/rules
 * The rules of a shared server that give its databases away by their name, the ended ones too,
 * which still decide the backups of their time. For whoever may see the shared databases.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await props.params;
    try {
        checkAnyPermissionWithContext(ctx, [SEE_SHARING_PERMISSION, SHARE_PERMISSION]);
        const assignments = await databaseAssignmentService.forSource(id, new Date(), await platformGroupService.reachOf(ctx.userId));
        return NextResponse.json({ success: true, data: assignments.rules });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Reading the rules failed", { sourceId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The rules could not be read" }, { status: 500 });
    }
}

/**
 * POST /api/adapters/[id]/database-assignments/rules
 * Adds a rule: every database of the server whose name matches the pattern goes to the tenant,
 * unless an assignment by name or a rule of a higher priority holds it. Someone of a platform group
 * of some tenants, and their key, adds rules for the tenants it reaches only.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id } = await props.params;
    try {
        checkPermissionWithContext(ctx, SHARE_PERMISSION);
        // A change happens in the tenant of the server, All tenants only reads.
        tenantOf(ctx);
        const parsed = AssignmentRuleSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

        const rule = await databaseAssignmentService.addRule(id, parsed.data, new Date(), await platformGroupService.reachOf(ctx.userId));
        await logRuleAdded({ id: ctx.userId, apiKeyId: ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null }, id, rule);
        return NextResponse.json({ success: true, data: rule }, { status: 201 });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Adding a rule failed", { sourceId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The rule could not be added" }, { status: 500 });
    }
}
