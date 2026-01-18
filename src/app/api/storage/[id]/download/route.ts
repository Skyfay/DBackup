import { NextRequest, NextResponse } from "next/server";
import { registerAdapters } from "@/lib/adapters";
import { storageService } from "@/services/storage-service";
import path from "path";
import os from "os";
import fs from "fs";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

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

        const tempDir = os.tmpdir();
        // Use random suffix to avoid collision if multiple downloads happen
        const tempName = `${path.basename(file)}_${Date.now()}`;
        tempFile = path.join(tempDir, tempName);

        // Delegate logic to Service with decrypt flag
        // Note: storageService handles config retrieval, decryption and adapter lookup
        const success = await storageService.downloadFile(params.id, file, tempFile, decrypt);

        if (!success) {
             if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
             return NextResponse.json({ error: "Download failed" }, { status: 500 });
        }

        // Stream file back
        // For large files, it's better to stream, but for simplicity readSync is used here as consistent with prev implementation
        const fileBuffer = fs.readFileSync(tempFile);

        fs.unlinkSync(tempFile);

        let downloadFilename = path.basename(file);
        if (decrypt && downloadFilename.endsWith('.enc')) {
            downloadFilename = downloadFilename.slice(0, -4);
        }

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Disposition": `attachment; filename="${downloadFilename}"`,
                "Content-Type": "application/octet-stream",
            }
        });

    } catch (error: any) {
        if (tempFile && fs.existsSync(tempFile)) {
             try { fs.unlinkSync(tempFile); } catch {}
        }

        console.error("Download error:", error);
         const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";

         if (errorMessage.includes("not found")) {
             return NextResponse.json({ error: errorMessage }, { status: 404 });
         }

        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
