import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext, tenantOf } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getTemplatesModel } from "@/services/templates/templates-model";

const log = logger.child({ route: "templates" });

/** The Templates page: the five kinds of templates, each with the jobs, destinations and folders that use it. */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.TEMPLATES.READ);
        // The page asks for a tenant first, All tenants would mix the lists of every tenant.
        tenantOf(ctx);
        return NextResponse.json({ success: true, data: await getTemplatesModel() });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the templates failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The templates could not be loaded" }, { status: 500 });
    }
}
