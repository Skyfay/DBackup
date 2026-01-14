import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    // 1. Authenticate (Optional: remove this block if avatars should be public but secure)
    // But since we are moving away from public/, let's enforce some access control or at least valid session.
    // If the image is used on public profiles, we might need to relax this or allow specific access.
    // For now, let's assume strict privacy.
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return new NextResponse(null, { status: 401 });
    }

    const { filename } = await params;

    // 2. Validate filename to prevent directory traversal
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename) {
        return new NextResponse("Invalid filename", { status: 400 });
    }

    const filePath = path.join(process.cwd(), "storage", "avatars", safeFilename);

    // 3. Check existence
    if (!existsSync(filePath)) {
        return new NextResponse("File not found", { status: 404 });
    }

    // 4. Determine Content-Type
    const ext = path.extname(safeFilename).toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".png") contentType = "image/png";
    else if (ext === ".gif") contentType = "image/gif";
    else if (ext === ".webp") contentType = "image/webp";

    // 5. Read file
    try {
        const fileBuffer = await fs.readFile(filePath);

        // 6. Return response with security headers
        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "private, max-age=3600",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        console.error("Error reading avatar:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
