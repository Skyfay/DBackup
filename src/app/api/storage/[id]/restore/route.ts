
import { NextRequest, NextResponse } from "next/server";
import { restoreService } from "@/services/restore/restore-service";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, ValidationError } from "@/lib/logging/errors";
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
        const { file, scope, targetSourceId, targetDatabaseName, databaseMapping, directoryMapping, excludePatterns, privilegedAuth, profileIdOverride } = body;

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
            // Patterns whose matching files are skipped; anything not a string list is ignored.
            excludePatterns: Array.isArray(excludePatterns)
                ? excludePatterns.filter((p: unknown): p is string => typeof p === 'string')
                : undefined,
            privilegedAuth,
            // The run happens in the background, so a key it cannot resolve has nobody to
            // ask. Whatever the user answered on the restore page is carried into it.
            ...(typeof profileIdOverride === "string" && profileIdOverride
                ? { keyOverride: { profileId: profileIdOverride } }
                : {}),
            triggerInfo: { type: "Manual", label: user?.name ?? "Unknown" },
        });

        // result contains { success: true, executionId: string, message: "Restore started" }
        return NextResponse.json(result, { status: 202 });

    } catch (error: unknown) {
        // A malformed request is the caller's to fix, not a server failure.
        if (error instanceof ValidationError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        log.error("Restore error", { storageId: params.id }, wrapError(error));
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
