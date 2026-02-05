import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { generateDownloadToken } from "@/lib/download-tokens";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ route: "storage/download-url" });

/**
 * Generate a download URL for a file
 *
 * This creates a temporary token-based URL that can be used to download
 * the file without authentication (e.g., via wget/curl from a server).
 * Tokens are single-use and expire after 5 minutes.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;

    try {
        await checkPermission(PERMISSIONS.STORAGE.DOWNLOAD);

        const body = await req.json();
        const { file, decrypt = true } = body;

        if (!file) {
            return NextResponse.json({ error: "Missing file param" }, { status: 400 });
        }

        // Generate a temporary download token
        // decrypt=true means the file will be decrypted before download
        // decrypt=false means the file will be downloaded as-is (encrypted)
        const token = generateDownloadToken(params.id, file, decrypt);

        // Create public download URL with token
        const baseUrl = req.headers.get("origin") || "";
        const downloadUrl = `${baseUrl}/api/storage/public-download?token=${token}`;

        return NextResponse.json({
            success: true,
            url: downloadUrl,
            expiresIn: "5 minutes",
            singleUse: true
        });

    } catch (error: unknown) {
        log.error("Generate download URL error", { storageId: params.id }, wrapError(error));

        if (error instanceof Error && error.message === "FORBIDDEN") {
            return NextResponse.json({ error: "Permission denied" }, { status: 403 });
        }

        return NextResponse.json({ error: "Failed to generate download URL" }, { status: 500 });
    }
}
