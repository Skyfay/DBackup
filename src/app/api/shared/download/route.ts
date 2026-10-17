import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { consumeSharedDownloadToken, markTokenUsed } from "@/lib/auth/download-tokens";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { tempFileDownloadResponse } from "@/lib/server/temp-file-response";

const log = logger.child({ route: "shared/download" });

/**
 * GET /api/shared/download?token= - hands a customer the dump of a database on a shared server
 * that `downloadSharedBackup` pulled out of the backup. The address carries the token alone, so the
 * customer never learns the destination of the server's tenant it came from. Like the download of a
 * destination, the token holds once, for five minutes, for the user and the tenant that asked for
 * it, and the temp file goes once it was sent. The download was noted in the audit log when it was
 * prepared.
 */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.DOWNLOAD);

        const token = new URL(req.url).searchParams.get("token");
        const claim = token && ctx.tenantId ? consumeSharedDownloadToken(token, ctx.userId, ctx.tenantId) : null;
        if (!token || !claim) {
            return NextResponse.json({ error: "This download has expired. Start it again." }, { status: 410 });
        }
        markTokenUsed(token);
        return tempFileDownloadResponse(claim.localFile.tempFile, claim.localFile.fileName, claim.localFile.contentType);
    } catch (error: unknown) {
        if (error instanceof PermissionError) {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        log.error("Shared download error", {}, wrapError(error));
        return NextResponse.json({ error: "The download failed." }, { status: 500 });
    }
}
