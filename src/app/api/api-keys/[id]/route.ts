import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getApiKeyDetails } from "@/services/auth/api-key-details";

const log = logger.child({ route: "api-keys/[id]" });

/** The panel of one key: the runs it started, who made it and when it was last rotated. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.API_KEYS.READ);
        const details = await getApiKeyDetails(id);
        if (!details) return NextResponse.json({ success: false, error: "The key no longer exists" }, { status: 404 });
        return NextResponse.json({ success: true, data: details });
    } catch (error: unknown) {
        if (error instanceof PermissionError) return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        log.error("Loading an API key failed", { apiKeyId: id }, wrapError(error));
        return NextResponse.json({ success: false, error: "The key could not be loaded" }, { status: 500 });
    }
}
