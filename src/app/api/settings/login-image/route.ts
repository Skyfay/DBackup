import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ValidationError } from "@/lib/logging/errors";
import { auditService } from "@/services/audit-service";
import { SETTINGS_AREAS } from "@/services/system/settings-audit";
import { getLoginImageInfo, LOGIN_IMAGE_MAX_BYTES, readLoginImage, removeLoginImage, saveLoginImage } from "@/services/system/login-image-service";
import { getSignInSettings } from "@/services/system/system-settings-service";

const FIELD = "Login image";

/** The stored picture for the preview in the settings, also while the login page shows the logos. */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.READ);

    const image = await readLoginImage();
    if (!image) return NextResponse.json({ success: false, error: "No picture" }, { status: 404 });
    return new NextResponse(Buffer.from(image.data), {
        headers: { "Content-Type": image.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
}

/** A new picture for the login page, `file` in a form, in place of the one before. */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "Pick a picture to upload." }, { status: 400 });
    if (file.size > LOGIN_IMAGE_MAX_BYTES) return NextResponse.json({ success: false, error: "The picture is larger than 5 MB." }, { status: 400 });

    const before = await getLoginImageInfo();
    try {
        const saved = await saveLoginImage(file.name, new Uint8Array(await file.arrayBuffer()));
        await auditService.logFor(ctx, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, {
            area: SETTINGS_AREAS.SIGN_IN,
            changes: [{ field: FIELD, from: before?.fileName ?? null, to: saved.fileName }],
        });
        return NextResponse.json({ success: true, data: saved });
    } catch (error: unknown) {
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        throw error;
    }
}

/** Removes the picture, and the login page shows the logos again. */
export async function DELETE() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE);

    const [before, { loginLook }] = await Promise.all([getLoginImageInfo(), getSignInSettings()]);
    if (!before) return NextResponse.json({ success: true });
    await removeLoginImage();
    await auditService.logFor(ctx, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, {
        area: SETTINGS_AREAS.SIGN_IN,
        changes: [
            { field: FIELD, from: before.fileName, to: null },
            ...(loginLook === "image" ? [{ field: "Login page", from: "Your own image", to: "DBackup logos" }] : []),
        ],
    });
    return NextResponse.json({ success: true });
}
