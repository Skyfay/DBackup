
import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
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
import { namedTenants } from "@/lib/core/audit-tenants";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { backupPathRefusal, configBackupRefusal } from "@/lib/server/config-backup-guard";

const log = logger.child({ route: "storage/restore" });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return unauthorized();
    }

    const params = await props.params;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.RESTORE);

        const body = await req.json();
        const { file, scope, targetSourceId, targetDatabaseName, databaseMapping, directoryMapping, excludePatterns, privilegedAuth, profileIdOverride, overwriteCustomerDatabases } = body;

        // A path that leaves the destination answers 400, see `assertBackupPath`.
        const badPath = backupPathRefusal(file);
        if (badPath) return badPath;
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
        }, ctx);

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
        // The customers whose databases it overwrote, which their own History never shows, with
        // their ids, so the log of the home tenant shows the entry only to whoever reaches them all.
        const overwritten = result.overwritten ?? [];
        const customers = [...new Set(overwritten.map((entry) => entry.customer))].sort((a, b) => a.localeCompare(b));
        const named = customers.length > 0 ? { customers, ...namedTenants(overwritten.map((entry) => entry.tenantId)) } : {};
        await auditService.logFor(ctx, AUDIT_ACTIONS.RESTORE, AUDIT_RESOURCES.BACKUP, { ...details, ...named }, params.id);

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
