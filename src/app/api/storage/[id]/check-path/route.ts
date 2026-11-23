import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { checkRestorePath } from "@/services/storage/restore-path-check";
import { isMissingStorage } from "@/services/storage/storage-lookup";
import { destinationAuditName } from "@/services/storage/backup-audit";
import { auditedProbe } from "@/services/adapters/probe-audit";
import { ANY_STORAGE_ROLE } from "@/services/sharing/destination-access";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { assertRestoreFolder } from "@/lib/archive/remote-paths";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/check-path" });

/**
 * Checks whether a directory restore target already has content, for the Overwrite/Empty
 * badge in the restore UI. Answers "occupied" or "empty", or "unverified" when the storage
 * cannot list the path. The target may be a directory source as well as a destination, see
 * `findRestoreTarget`, and the check goes into the audit log as `path_check`.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return unauthorized();
    }

    const params = await props.params;
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.RESTORE);

        const body = await req.json();
        const { path: targetPath } = body;

        if (typeof targetPath !== 'string') {
            return NextResponse.json({ error: "Invalid path" }, { status: 400 });
        }
        // A folder that leaves the connection answers 400 before anything is dialed, see `assertRestoreFolder`.
        assertRestoreFolder(targetPath);

        // Written once the storage was asked. A storage the tenant may not use writes nothing.
        const name = await destinationAuditName(params.id, { roles: ANY_STORAGE_ROLE });
        const target = { record: { id: params.id, name }, path: targetPath };
        return NextResponse.json(await auditedProbe(ctx, "path_check", target, () => checkRestorePath(params.id, targetPath)));
    } catch (e: unknown) {
        const refused = requestRefusal(e);
        if (refused) return refused;
        if (isMissingStorage(e)) {
            return NextResponse.json({ error: "Storage adapter not found" }, { status: 404 });
        }
        log.error("Checking a restore path failed", { storageId: params.id }, wrapError(e));
        return NextResponse.json({ error: "The path could not be checked. The log of DBackup has the details." }, { status: 500 });
    }
}
