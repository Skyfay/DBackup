import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getApiKeysModel } from "@/services/auth/api-keys-model";

const log = logger.child({ route: "api-keys" });

/** The API keys tab: every key with its owner and what it may do right now. Never a secret or a hash. */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.API_KEYS.READ);
        const model = await getApiKeysModel({ id: ctx.userId, superAdmin: ctx.isSuperAdmin, permissions: ctx.permissions });
        return NextResponse.json({ success: true, data: model });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading the API keys failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The API keys could not be loaded" }, { status: 500 });
    }
}
