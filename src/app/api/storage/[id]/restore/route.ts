
import { NextRequest, NextResponse } from "next/server";
import { restoreService } from "@/services/restore/restore-service";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, NotFoundError } from "@/lib/logging/errors";
import { auditService } from "@/services/audit-service";
import { userService } from "@/services/user/user-service";
import { restoreAuditDetails } from "@/services/storage/backup-audit";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { configBackupRefusal } from "@/lib/server/config-backup-guard";

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
        const { file, scope, targetSourceId, targetDatabaseName, databaseMapping, directoryMapping, excludePatterns, privilegedAuth, profileIdOverride, overwriteCustomerDatabases } = body;

        if (!file || typeof file !== 'string' || file.includes('..') || file.startsWith('/')) {
            return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
        }
        // A configuration backup goes back through the configuration restore, only for a platform admin.
        const configBackup = await configBackupRefusal(ctx, params.id, file);
        if (configBackup) return configBackup;

        const startedBy = (await userService.nameOf(ctx.userId)) ?? "Unknown";

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
            triggerInfo: { type: "Manual", label: startedBy },
            // Databases customers hold now on a shared server go back only once this is true.
            overwriteCustomerDatabases: overwriteCustomerDatabases === true,
        });

        // Written once the restore was accepted and runs, with where it goes and what it picked.
        const details = await restoreAuditDetails({
            destinationId: params.id,
            file,
            executionId: result.executionId,
            scope: scope === 'databases' || scope === 'files' ? scope : undefined,
            targetSourceId,
            targetDatabaseName,
            databaseMapping,
            directoryMapping,
        });
        // The customers whose databases it overwrote, which their own History never shows.
        const customers = [...new Set((result.overwritten ?? []).map((entry) => entry.customer))].sort((a, b) => a.localeCompare(b));
        await auditService.logFor(ctx, AUDIT_ACTIONS.RESTORE, AUDIT_RESOURCES.BACKUP, customers.length > 0 ? { ...details, customers } : details, params.id);

        // result contains { success: true, executionId: string, message: "Restore started" }
        const { overwritten: _overwritten, ...answer } = result;
        return NextResponse.json(answer, { status: 202 });

    } catch (error: unknown) {
        // A malformed request, like an archive outside the caller's view of the destination, is
        // the caller's to fix, not a server failure.
        const refused = requestRefusal(error);
        if (refused) return refused;
        if (error instanceof NotFoundError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        log.error("Restore error", { storageId: params.id }, wrapError(error));
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
