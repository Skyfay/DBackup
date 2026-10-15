import { NextRequest, NextResponse } from "next/server";
import { startCopyVerification } from "@/services/storage/copy-verification";
import { userService } from "@/services/user/user-service";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/verify-async" });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const params = await props.params;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);

        const body = await req.json();
        const { file } = body;

        if (!file || typeof file !== "string" || file.includes("..") || file.startsWith("/")) {
            return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
        }

        const startedBy = (await userService.nameOf(ctx.userId)) ?? "Manual";
        // One copy is a check of copies with one entry, so it runs, logs and notifies the same way.
        const { executionId } = await startCopyVerification([{ destinationId: params.id, file }], startedBy);

        return NextResponse.json({ success: true, executionId });
    } catch (error: unknown) {
        log.error("Verify-async route error", { id: params.id }, wrapError(error));
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
