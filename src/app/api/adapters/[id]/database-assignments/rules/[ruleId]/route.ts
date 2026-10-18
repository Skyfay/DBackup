import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, tenantOf } from "@/lib/auth/access-control";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { serviceRefusal } from "@/lib/server/permission-refusal";
import { SHARE_PERMISSION } from "@/lib/tenant/sharing";
import { logRuleRemoved } from "@/services/tenant/assignment-audit";
import { databaseAssignmentService } from "@/services/tenant/database-assignments";
import { platformGroupService } from "@/services/user/platform-group-service";

const log = logger.child({ route: "adapters/[id]/database-assignments/rules/[ruleId]" });

/**
 * DELETE /api/adapters/[id]/database-assignments/rules/[ruleId]
 * Ends a rule. The backups made while it gave a database stay with its customer, like after an
 * ended assignment. Someone of a platform group of some tenants, and their key, ends the rules of
 * the tenants it reaches only.
 */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string; ruleId: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { id, ruleId } = await props.params;
    try {
        checkPermissionWithContext(ctx, SHARE_PERMISSION);
        tenantOf(ctx);
        const removed = await databaseAssignmentService.removeRule(id, ruleId, new Date(), await platformGroupService.reachOf(ctx.userId));
        await logRuleRemoved({ id: ctx.userId, apiKeyId: ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null }, id, removed);
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const refusal = serviceRefusal(error);
        if (refusal) return refusal;
        log.error("Removing a rule failed", { sourceId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The rule could not be removed" }, { status: 500 });
    }
}
