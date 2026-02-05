import { NextRequest, NextResponse } from "next/server";
import { registerAdapters } from "@/lib/adapters";
import { storageService } from "@/services/storage-service";
import { getTempDir } from "@/lib/temp-dir";
import path from "path";
import fs from "fs";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { wrapError, getErrorMessage } from "@/lib/errors";

const log = logger.child({ route: "storage/download" });
registerAdapters();

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    let tempFile: string | null = null;

    try {
        await checkPermission(PERMISSIONS.STORAGE.DOWNLOAD);

        const { searchParams } = new URL(req.url);
        const file = searchParams.get("file");
        const decrypt = searchParams.get("decrypt") === "true";

        if (!file) {
             return NextResponse.json({ error: "Missing file param" }, { status: 400 });
        }

        const tempDir = getTempDir();
        // Use random suffix to avoid collision if multiple downloads happen
        const tempName = `${path.basename(file)}_${Date.now()}`;
        tempFile = path.join(tempDir, tempName);

        // Delegate logic to Service with decrypt flag
        // Note: storageService handles config retrieval, decryption and adapter lookup
        const result = await storageService.downloadFile(params.id, file, tempFile, decrypt);

        if (!result.success) {
             if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
             return NextResponse.json({ error: "Download failed" }, { status: 500 });
        }

        // Stream file back
        // For large files, it's better to stream, but for simplicity readSync is used here as consistent with prev implementation
        const fileBuffer = fs.readFileSync(tempFile);

        fs.unlinkSync(tempFile);

        let downloadFilename = path.basename(file);

        if (result.isZip) {
            downloadFilename = downloadFilename.replace(/\.enc$/, '') + '.zip';
            // If it was eg. backup.sql.enc -> backup.sql.zip
            // If just backup.enc -> backup.zip
            if (!downloadFilename.endsWith('.zip')) downloadFilename += '.zip';
        } else if (decrypt && downloadFilename.endsWith('.enc')) {
            downloadFilename = downloadFilename.slice(0, -4);
        }

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Disposition": `attachment; filename="${downloadFilename}"`,
                "Content-Type": result.isZip ? "application/zip" : "application/octet-stream",
            }
        });

    } catch (error: unknown) {
        if (tempFile && fs.existsSync(tempFile)) {
             try { fs.unlinkSync(tempFile); } catch {}
        }

        log.error("Download error", { storageId: params.id }, wrapError(error));
         const errorMessage = getErrorMessage(error) || "An unknown error occurred";

         if (errorMessage.includes("not found")) {
             return NextResponse.json({ error: errorMessage }, { status: 404 });
         }

        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
