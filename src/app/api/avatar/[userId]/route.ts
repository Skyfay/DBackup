import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/access-control";
import { findVisibleAvatar } from "@/services/user/account-visibility";

/**
 * The picture of a person, to whoever sees their name beside it, see `maySeePicture`. It shows in
 * the lists of every page, so the route checks no permission. Anyone else gets the answer of a
 * person without a picture, and the page shows initials. Its type was read from its bytes when it
 * was stored.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return new NextResponse(null, { status: 401 });

    const avatar = await findVisibleAvatar(ctx, (await params).userId);
    if (!avatar) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(avatar.data), {
        headers: {
            "Content-Type": avatar.mimeType,
            "Content-Length": String(avatar.data.length),
            // The address carries the time of the picture in `?v=`, so a new picture gets a new address
            // and the browser keeps each one for good. Without it an hour.
            "Cache-Control": req.nextUrl.searchParams.has("v") ? "private, max-age=31536000, immutable" : "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
