
import { NextRequest, NextResponse } from "next/server";
import { restoreService } from "@/services/restore/restore-service";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import prisma from "@/lib/prisma";

const log = logger.child({ route: "storage/restore" });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.RESTORE);

        const body = await req.json();
        const { file, scope, targetSourceId, targetDatabaseName, databaseMapping, directoryMapping, privilegedAuth } = body;

        if (!file || typeof file !== 'string' || file.includes('..') || file.startsWith('/')) {
            return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });

        const result = await restoreService.restore({
            storageConfigId: params.id,
            file,
            // Anything unrecognised restores everything, same as omitting it.
            scope: scope === 'databases' || scope === 'files' ? scope : undefined,
            targetSourceId: targetSourceId || undefined,
            targetDatabaseName,
            databaseMapping,
            directoryMapping: Array.isArray(directoryMapping) ? directoryMapping : undefined,
            privilegedAuth,
            triggerInfo: { type: "Manual", label: user?.name ?? "Unknown" },
        });

        // result contains { success: true, executionId: string, message: "Restore started" }
        return NextResponse.json(result, { status: 202 });

    } catch (error: unknown) {
        log.error("Restore error", { storageId: params.id }, wrapError(error));
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
