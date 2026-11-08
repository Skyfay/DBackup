
import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, checkAnyPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { keyRequiredResponse } from "@/lib/server/key-required-response";
import { requestRefusal } from "@/lib/server/permission-refusal";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { backupPathRefusal, configBackupRefusal } from "@/lib/server/config-backup-guard";
import { analyzeBackup } from "@/services/storage/backup-contents";
import { isMissingStorage } from "@/services/storage/storage-lookup";

const log = logger.child({ route: "storage/analyze" });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return unauthorized();
    }

    const params = await props.params;
    try {
        // Read-only: listing what a backup holds is part of restoring it and of downloading from it.
        checkAnyPermissionWithContext(ctx, [PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.STORAGE.DOWNLOAD]);

        const body = await req.json();
        // profileIdOverride: the vault profile the user picked after being asked for a key.
        // Every request that opens this backup carries it, because the one that raised the
        // question is rarely the last one that needs the answer.
        const { file, type, profileIdOverride } = body;
        const keyOverride = typeof profileIdOverride === "string" && profileIdOverride
            ? { profileId: profileIdOverride }
            : undefined;

        // A path that leaves the destination answers 400, see `assertBackupPath`.
        const badPath = backupPathRefusal(file);
        if (badPath) return badPath;
        const configBackup = await configBackupRefusal(ctx, params.id, file);
        if (configBackup) return configBackup;

        return NextResponse.json(await analyzeBackup(params.id, file, type, keyOverride));
    } catch (e: unknown) {
        // A request the caller has to fix, like a key that is no 64 hex characters, answers 400.
        const refused = requestRefusal(e);
        if (refused) return refused;
        // A backup nobody holds the key for is answerable, so it is reported rather than
        // rendered as an archive with nothing in it.
        const keyRequired = keyRequiredResponse(e);
        if (keyRequired) return keyRequired;

        if (isMissingStorage(e)) {
            return NextResponse.json({ error: "Storage adapter not found" }, { status: 404 });
        }
        log.error("Analyzing a backup failed", { storageId: params.id }, wrapError(e));
        return NextResponse.json({ error: "The backup could not be read. The log of DBackup has the details." }, { status: 500 });
    }
}
