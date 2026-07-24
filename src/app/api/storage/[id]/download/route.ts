import { NextRequest, NextResponse } from "next/server";
import { registerAdapters } from "@/lib/adapters";
import { storageService } from "@/services/storage/storage-service";
import { getTempDir } from "@/lib/temp-dir";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import { generateFileDownloadToken, consumeFileDownloadToken, markTokenUsed } from "@/lib/auth/download-tokens";
import { z } from "zod";

const log = logger.child({ route: "storage/download" });
registerAdapters();

/** What the decrypted result is called - shared so a prepared download is named identically. */
function decryptedFileName(file: string, isZip: boolean, decrypt = true): string {
    let downloadFilename = path.basename(file);

    if (isZip) {
        downloadFilename = downloadFilename.replace(/\.enc$/, '') + '.zip';
        if (!downloadFilename.endsWith('.zip')) downloadFilename += '.zip';
    } else if (decrypt && downloadFilename.endsWith('.enc')) {
        downloadFilename = downloadFilename.slice(0, -4);
    }

    return downloadFilename;
}

/** Shared helper: stream the tempFile back as a download response and schedule cleanup. */
function buildDownloadResponse(tempFile: string, file: string, decrypt: boolean, isZip: boolean) {
    const stat = fs.statSync(tempFile);
    const downloadFilename = decryptedFileName(file, isZip, decrypt);

    const fileStream = fs.createReadStream(tempFile);
    const readableStream = new ReadableStream({
        start(controller) {
            fileStream.on('data', (chunk: Buffer | string) => controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
            fileStream.on('end', () => {
                controller.close();
                fsPromises.unlink(tempFile).catch(() => {});
            });
            fileStream.on('error', (err) => {
                controller.error(err);
                fsPromises.unlink(tempFile).catch(() => {});
            });
        }
    });

    return new NextResponse(readableStream, {
        headers: {
            "Content-Disposition": `attachment; filename="${downloadFilename}"`,
            "Content-Type": isZip ? "application/zip" : "application/octet-stream",
            "Content-Length": String(stat.size),
        }
    });
}

/** Streams a file a prepare step already produced, then removes it. */
function buildPreparedResponse(tempFile: string, fileName: string, contentType: string) {
    const stat = fs.statSync(tempFile);
    const fileStream = fs.createReadStream(tempFile);
    const readableStream = new ReadableStream({
        start(controller) {
            fileStream.on('data', (chunk: Buffer | string) => controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
            fileStream.on('end', () => {
                controller.close();
                fsPromises.unlink(tempFile).catch(() => { });
            });
            fileStream.on('error', (err) => {
                controller.error(err);
                fsPromises.unlink(tempFile).catch(() => { });
            });
        }
    });

    return new NextResponse(readableStream, {
        headers: {
            "Content-Disposition": `attachment; filename="${fileName}"`,
            "Content-Type": contentType,
            "Content-Length": String(stat.size),
        }
    });
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    let tempFile: string | null = null;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.DOWNLOAD);

        const { searchParams } = new URL(req.url);

        // A token means the work already happened in a prepare step: fetching, and decrypting
        // if it was needed. All that is left is handing the finished file to the browser, which
        // is what keeps a large backup out of the tab's memory.
        const token = searchParams.get("token");
        if (token) {
            const claim = consumeFileDownloadToken(token, ctx.userId);
            if (!claim || claim.storageId !== params.id) {
                return NextResponse.json(
                    { error: "This download has expired. Start it again." },
                    { status: 410 }
                );
            }
            markTokenUsed(token);
            return buildPreparedResponse(claim.localFile.tempFile, claim.localFile.fileName, claim.localFile.contentType);
        }

        const file = searchParams.get("file");
        const decrypt = searchParams.get("decrypt") === "true";
        const profileIdOverride = searchParams.get("profileIdOverride") || undefined;

        if (!file || file.includes('..') || file.startsWith('/')) {
             return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
        }

        const tempDir = getTempDir();
        // Use random suffix to avoid collision if multiple downloads happen
        const tempName = `${path.basename(file)}_${Date.now()}`;
        tempFile = path.join(tempDir, tempName);

        // Delegate logic to Service with decrypt flag
        // Note: storageService handles config retrieval, decryption and adapter lookup
        const result = await storageService.downloadFile(params.id, file, tempFile, decrypt, { profileIdOverride });

        if (!result.success) {
             await fsPromises.unlink(tempFile).catch(() => {});
             return NextResponse.json({ error: "Download failed" }, { status: 500 });
        }

        return buildDownloadResponse(tempFile, file, decrypt, result.isZip ?? false);

    } catch (error: unknown) {
        if (tempFile) {
             await fsPromises.unlink(tempFile).catch(() => {});
        }

        log.error("Download error", { storageId: params.id }, wrapError(error));
        const errorMessage = getErrorMessage(error) || "An unknown error occurred";

        if (errorMessage.startsWith("ENCRYPTION_KEY_REQUIRED:")) {
            const profileId = errorMessage.split(":").slice(1).join(":") || "unknown";
            return NextResponse.json({
                error: "Encryption key not found. Smart Recovery could not find a matching key. Please provide a decryption key.",
                code: "ENCRYPTION_KEY_REQUIRED",
                profileId,
            }, { status: 422 });
        }

        if (errorMessage.includes("not found")) {
            return NextResponse.json({ error: errorMessage }, { status: 404 });
        }

        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}

const postBodySchema = z.object({
    file: z.string().min(1),
    /** Omit when the key comes from the vault; only a manual recovery supplies one. */
    rawKeyHex: z.string().regex(/^[0-9a-fA-F]{64}$/, "Must be a 64-character hex string (32 bytes).").optional(),
    /** Decrypt with a different vault profile than the one recorded in the backup. */
    profileIdOverride: z.string().min(1).optional(),
    /**
     * Fetch and decrypt into a temp file and return a token, rather than the bytes. The
     * browser then collects the finished file itself, so it never passes through the page.
     */
    prepare: z.boolean().optional(),
});

/** POST /api/storage/[id]/download - Decrypted download using a caller-supplied raw key. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    let tempFile: string | null = null;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.DOWNLOAD);

        const body = await req.json();
        const parsed = postBodySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 });
        }

        const { file, rawKeyHex, profileIdOverride, prepare } = parsed.data;

        if (file.includes('..') || file.startsWith('/')) {
            return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
        }

        const tempDir = getTempDir();
        const tempName = `${path.basename(file)}_${Date.now()}`;
        tempFile = path.join(tempDir, tempName);

        const result = await storageService.downloadFile(params.id, file, tempFile, true, { rawKeyHex, profileIdOverride });

        if (!result.success) {
            await fsPromises.unlink(tempFile).catch(() => {});
            return NextResponse.json({ error: "Download failed" }, { status: 500 });
        }

        if (prepare) {
            // The temp file now belongs to the token, so it must survive this request - the
            // GET that collects it deletes it, and the token sweeper cleans up one that is
            // never collected.
            const isZip = result.isZip ?? false;
            const token = generateFileDownloadToken({
                storageId: params.id,
                file,
                userId: ctx.userId,
                tempFile,
                fileName: decryptedFileName(file, isZip),
                contentType: isZip ? "application/zip" : "application/octet-stream",
            });
            tempFile = null;

            return NextResponse.json({ success: true, data: { token } });
        }

        return buildDownloadResponse(tempFile, file, true, result.isZip ?? false);

    } catch (error: unknown) {
        if (tempFile) {
            await fsPromises.unlink(tempFile).catch(() => {});
        }

        log.error("Decrypt-download (POST) error", { storageId: params.id }, wrapError(error));
        const errorMessage = getErrorMessage(error) || "An unknown error occurred";

        // Same contract as the GET path, so the key dialog opens for a prepare too.
        if (errorMessage.startsWith("ENCRYPTION_KEY_REQUIRED:")) {
            const profileId = errorMessage.split(":").slice(1).join(":") || "unknown";
            return NextResponse.json({
                error: "Encryption key not found. Smart Recovery could not find a matching key. Please provide a decryption key.",
                code: "ENCRYPTION_KEY_REQUIRED",
                profileId,
            }, { status: 422 });
        }

        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
