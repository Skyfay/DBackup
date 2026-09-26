import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { registerAdapters } from "@/lib/adapters";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { generateLinkToken, linkStatus } from "@/lib/auth/download-tokens";
import { keyRequiredResponse } from "@/lib/server/key-required-response";
import { planArchiveDownload } from "@/services/restore/archive-download";
import { logger } from "@/lib/logging/logger";
import { PermissionError, getErrorMessage, wrapError } from "@/lib/logging/errors";

registerAdapters();

const log = logger.child({ route: "storage/download-url" });

const LinkSchema = z.object({
    file: z.string().min(1).refine((v) => !v.includes("..") && !v.startsWith("/"), "Invalid file path"),
    /** False keeps the file as it is stored, encrypted when the job encrypts. */
    decrypt: z.boolean().default(true),
    /** The one dump a decrypted link of a seekable archive holds, for older callers. */
    database: z.string().min(1).optional(),
    /** Several dumps, folders or both out of a seekable archive, streamed as one dump or a tar.gz. */
    databases: z.array(z.string().min(1)).min(1).optional(),
    selections: z.array(z.object({ src: z.string().min(1), paths: z.array(z.string().min(1)).min(1).optional() })).min(1).optional(),
    /** Vault profile to open the backup with, when the one it names does not fit. */
    profileIdOverride: z.string().min(1).optional(),
});

function failure(error: unknown, storageId: string, what: string): NextResponse {
    if (error instanceof PermissionError) return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    log.error(what, { storageId }, wrapError(error));
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
}

/**
 * Makes a link that downloads a backup, or part of one, without a session, for wget, curl or
 * PowerShell on another host. A link works for one complete download within five minutes.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { id } = await props.params;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.DOWNLOAD);

        const parsed = LinkSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
        }
        const { file, decrypt, database, databases, selections, profileIdOverride } = parsed.data;

        let fileName: string | undefined;
        const pick = databases || selections ? { databases, selections, profileIdOverride } : undefined;
        if (pick) {
            // Opening the archive now reports a missing key or an empty pick while the dialog
            // can still ask, instead of on a server that only sees a failed download.
            const plan = await planArchiveDownload({
                storageConfigId: id, file, databases, selections, target: { kind: "download" },
                ...(profileIdOverride ? { keyOverride: { profileId: profileIdOverride } } : {}),
            });
            fileName = plan.fileName;
        }

        const { token, expiresAt } = generateLinkToken({ storageId: id, file, userId: ctx.userId, decrypt: pick ? true : decrypt, database, pick });
        const url = `${req.headers.get("origin") || ""}/api/storage/public-download?token=${token}`;

        return NextResponse.json({
            success: true,
            data: { url, token, expiresAt, ...(fileName ? { fileName } : {}) },
            // Kept at the top for callers written before the data object.
            url,
            expiresIn: "5 minutes",
            singleUse: true,
        });
    } catch (error: unknown) {
        const keyRequired = keyRequiredResponse(error);
        if (keyRequired) return keyRequired;
        return failure(error, id, "Generate download URL error");
    }
}

/**
 * Whether a link was fetched yet, for the dialog that made it. Only its maker gets an answer,
 * so a token seen in a log tells nobody else anything.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { id } = await props.params;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.DOWNLOAD);

        const token = new URL(req.url).searchParams.get("token");
        if (!token) return NextResponse.json({ success: false, error: "Missing token" }, { status: 400 });

        const status = linkStatus(token, ctx.userId);
        // A link that ran out is removed from the store, so no answer reads as expired.
        return NextResponse.json({ success: true, data: status ?? { state: "expired" } });
    } catch (error: unknown) {
        return failure(error, id, "Download link status error");
    }
}
