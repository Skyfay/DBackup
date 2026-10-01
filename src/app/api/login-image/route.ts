import { NextRequest, NextResponse } from "next/server";
import { readPublicLoginImage } from "@/services/system/login-image-service";

/**
 * The picture of the login page. Public on purpose: the login page shows it before anyone signs in.
 * It answers only while Your own image is picked under Settings, Sign-in, and only with that one
 * picture, whose type was read from its bytes when it was stored.
 */
export async function GET(req: NextRequest) {
    const image = await readPublicLoginImage();
    if (!image) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(image.data), {
        headers: {
            "Content-Type": image.mimeType,
            "Content-Length": String(image.data.length),
            // The login page asks with the time of the picture in `?v=`, so a new picture gets a new
            // address and the browser keeps each one for good. Without it an hour.
            "Cache-Control": req.nextUrl.searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
            "Last-Modified": image.updatedAt.toUTCString(),
            "X-Content-Type-Options": "nosniff",
        },
    });
}
