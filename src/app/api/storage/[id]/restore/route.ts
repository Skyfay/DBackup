
import { NextRequest, NextResponse } from "next/server";
import { restoreService } from "@/services/restore-service";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { wrapError, getErrorMessage } from "@/lib/errors";

const log = logger.child({ route: "storage/restore" });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;

    try {
        await checkPermission(PERMISSIONS.STORAGE.RESTORE);

        const body = await req.json();
        const { file, targetSourceId, targetDatabaseName, databaseMapping, privilegedAuth } = body;

        const result = await restoreService.restore({
            storageConfigId: params.id,
            file,
            targetSourceId,
            targetDatabaseName,
            databaseMapping,
            privilegedAuth
        });

        // result contains { success: true, executionId: string, message: "Restore started" }
        return NextResponse.json(result, { status: 202 });

    } catch (error: unknown) {
        log.error("Restore error", { storageId: params.id }, wrapError(error));
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
