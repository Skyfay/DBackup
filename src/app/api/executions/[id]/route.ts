import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiKeyError, NotFoundError } from "@/lib/logging/errors";
import { getRunStatus } from "@/services/history/run-status";

export async function GET(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    let ctx;
    try {
        ctx = await getAuthContext(await headers());
    } catch (error) {
        if (error instanceof ApiKeyError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: 401 }
            );
        }
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.HISTORY.READ);

        const { id } = await props.params;
        const { searchParams } = new URL(req.url);
        const includeLogs = searchParams.get("includeLogs") === "true";

        const data = await getRunStatus(id, { includeLogs });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof NotFoundError) {
            return NextResponse.json(
                { success: false, error: "Execution not found" },
                { status: 404 }
            );
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        const status = error instanceof Error && message.includes("Permission") ? 403 : 500;
        return NextResponse.json(
            { success: false, error: message },
            { status }
        );
    }
}
