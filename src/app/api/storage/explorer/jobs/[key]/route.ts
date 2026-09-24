import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { registerAdapters } from "@/lib/adapters";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { storageExplorerService } from "@/services/storage/explorer-service";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/explorer/jobs" });

registerAdapters();

/** The key as the index gave it. Decoding twice is harmless, a stray "%" in a job name is kept. */
function decodeKey(key: string): string {
    try {
        return decodeURIComponent(key);
    } catch {
        return key;
    }
}

/**
 * GET /api/storage/explorer/jobs/[key]
 * The runs of one job with their copies at every destination. The key is a job id, or the key the
 * index gives a deleted job, the config backups or the files without a job.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ key: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);
        const { key } = await props.params;
        const data = await storageExplorerService.getJobView(decodeKey(key));
        if (!data) return NextResponse.json({ success: false, error: "No backups of this job" }, { status: 404 });
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 403 });
        }
        log.error("Failed to load the backups of a job", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to load the backups" }, { status: 500 });
    }
}
