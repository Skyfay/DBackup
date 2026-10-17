import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { AuthContext, getAuthContext } from "@/lib/auth/access-control";
import { generateFileDownloadToken, consumeFileDownloadToken, markTokenUsed } from "@/lib/auth/download-tokens";
import { tempFileDownloadResponse } from "@/lib/server/temp-file-response";
import { DATABASE_BUSY } from "@/lib/server/database-maintenance";
import { createDatabaseSnapshot } from "@/services/system/database-service";
import { platformLogFor } from "@/services/system/settings-save";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ServiceError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ route: "settings/database/download" });

/**
 * Tokens for this download carry this in place of a storage id, so a database token can never be
 * redeemed against a storage download route and the other way round.
 */
const DATABASE_DOWNLOAD_SCOPE = "dbackup-database";

/**
 * Security: deliberately stricter than any permission. The file holds every user's password hash,
 * active session tokens and all stored credentials, so a copy is enough to take over the instance.
 * Only a platform admin signed in with a session qualifies, which also rules out API keys.
 */
async function requirePlatformAdmin(): Promise<AuthContext | NextResponse> {
    let ctx: AuthContext | null;
    try {
        ctx = await getAuthContext(await headers());
    } catch {
        // An invalid, disabled or expired API key.
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!ctx.isPlatformAdmin || ctx.authMethod !== "session") {
        return NextResponse.json({ error: "Only platform admins can download the database." }, { status: 403 });
    }
    return ctx;
}

/**
 * Prepares a consistent copy of the database and returns a single-use token for it.
 *
 * Two steps so the browser fetches the file itself and writes it straight to disk, and so a
 * refusal (for example a backup still running) reaches the page as a readable error.
 */
export async function POST() {
    const ctx = await requirePlatformAdmin();
    if (ctx instanceof NextResponse) return ctx;

    try {
        const snapshot = await createDatabaseSnapshot();

        await auditService.log(
            ctx.userId,
            AUDIT_ACTIONS.EXPORT,
            AUDIT_RESOURCES.SYSTEM,
            { action: "database_download", sizeBytes: snapshot.sizeBytes },
            undefined,
            platformLogFor(ctx)
        );

        const token = generateFileDownloadToken({
            storageId: DATABASE_DOWNLOAD_SCOPE,
            file: snapshot.fileName,
            userId: ctx.userId,
            tempFile: snapshot.tempFile,
            fileName: snapshot.fileName,
            contentType: "application/vnd.sqlite3",
        });

        return NextResponse.json({
            success: true,
            data: { token, fileName: snapshot.fileName, sizeBytes: snapshot.sizeBytes },
        });
    } catch (error: unknown) {
        if (error instanceof ServiceError && error.code === DATABASE_BUSY) {
            return NextResponse.json({ success: false, error: error.message }, { status: 409 });
        }
        log.error("Failed to prepare database download", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "Failed to prepare the database download. See the server log for details." }, { status: 500 });
    }
}

/** Streams a prepared copy. Only the user who prepared it can collect it. */
export async function GET(req: NextRequest) {
    const ctx = await requirePlatformAdmin();
    if (ctx instanceof NextResponse) return ctx;

    const token = req.nextUrl.searchParams.get("token");
    const claim = token ? consumeFileDownloadToken(token, ctx.userId) : null;
    if (!token || !claim || claim.storageId !== DATABASE_DOWNLOAD_SCOPE) {
        return NextResponse.json({ error: "This download has expired. Start it again." }, { status: 410 });
    }

    markTokenUsed(token);
    return tempFileDownloadResponse(claim.localFile.tempFile, claim.localFile.fileName, claim.localFile.contentType);
}
