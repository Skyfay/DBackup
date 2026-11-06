import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { NotFoundError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { permissionRefusal } from "@/lib/server/permission-refusal";
import { getRunStatus } from "@/services/history/run-status";

const log = logger.child({ route: "executions/[id]" });

export async function GET(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    // A disabled, expired or blocked API key is answered by `unauthorized` with its reason.
    const ctx = await getAuthContext(await headers()).catch(() => null);

    if (!ctx) {
        return unauthorized();
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
        const refused = permissionRefusal(error);
        if (refused) return refused;
        log.error("Reading the status of a run failed", {}, wrapError(error));
        return NextResponse.json(
            { success: false, error: "The status of the run could not be read." },
            { status: 500 }
        );
    }
}
