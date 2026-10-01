import { NextResponse } from "next/server";
import { readPublicLoginImage } from "@/services/system/login-image-service";

/**
 * The picture of the login page. Public on purpose: the login page shows it before anyone signs in.
 * It answers only while Your own image is picked under Settings, Sign-in, and only with that one
 * picture, whose type was read from its bytes when it was stored.
 */
export async function GET() {
    const image = await readPublicLoginImage();
    if (!image) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(image.data), {
        headers: {
            "Content-Type": image.mimeType,
            "Content-Length": String(image.data.length),
            // The login page asks with the time of the picture, so a new one gets a new address.
            "Cache-Control": "public, max-age=3600",
            "Last-Modified": image.updatedAt.toUTCString(),
            "X-Content-Type-Options": "nosniff",
        },
    });
}
