import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { checkPermissionWithContext, getAuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ValidationError } from "@/lib/logging/errors";
import { auditService } from "@/services/audit-service";
import { SETTINGS_AREAS } from "@/services/system/settings-audit";
import { platformLogFor } from "@/services/system/settings-save";
import { getLoginImageInfo, LOGIN_IMAGE_MAX_BYTES, readLoginImage, removeLoginImage, saveLoginImage } from "@/services/system/login-image-service";
import { getSignInSettings } from "@/services/system/system-settings-service";
import { bodyTooLarge } from "@/lib/server/upload-size";
import { refusedUnless } from "@/lib/server/permission-refusal";
import { IMAGE_SECURITY_HEADERS, servedImageType } from "@/lib/server/image-response";

const FIELD = "Login image";

/** The stored picture for the preview in the settings, also while the login page shows the logos. */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();
    const refused = refusedUnless(() => checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.READ));
    if (refused) return refused;

    const image = await readLoginImage();
    // A stored row of another type than an upload is stored with is never served.
    const type = servedImageType(image?.mimeType);
    if (!image || !type) return NextResponse.json({ success: false, error: "No picture" }, { status: 404 });
    return new NextResponse(Buffer.from(image.data), {
        headers: { ...IMAGE_SECURITY_HEADERS, "Content-Type": type, "Cache-Control": "private, no-store" },
    });
}

/** A new picture for the login page, `file` in a form, in place of the one before. */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();
    const refused = refusedUnless(() => checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE));
    if (refused) return refused;

    if (bodyTooLarge(req.headers, LOGIN_IMAGE_MAX_BYTES)) return NextResponse.json({ success: false, error: "The picture is larger than 5 MB." }, { status: 413 });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "Pick a picture to upload." }, { status: 400 });
    if (file.size > LOGIN_IMAGE_MAX_BYTES) return NextResponse.json({ success: false, error: "The picture is larger than 5 MB." }, { status: 400 });

    const before = await getLoginImageInfo();
    try {
        const saved = await saveLoginImage(file.name, new Uint8Array(await file.arrayBuffer()));
        await auditService.log(ctx.userId, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, {
            area: SETTINGS_AREAS.SIGN_IN,
            changes: [{ field: FIELD, from: before?.fileName ?? null, to: saved.fileName }],
        }, undefined, platformLogFor(ctx));
        return NextResponse.json({ success: true, data: saved });
    } catch (error: unknown) {
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        throw error;
    }
}

/** Removes the picture, and the login page shows the logos again. */
export async function DELETE() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();
    const refused = refusedUnless(() => checkPermissionWithContext(ctx, PERMISSIONS.SETTINGS.WRITE));
    if (refused) return refused;

    const [before, { loginLook }] = await Promise.all([getLoginImageInfo(), getSignInSettings()]);
    if (!before) return NextResponse.json({ success: true });
    await removeLoginImage();
    await auditService.log(ctx.userId, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, {
        area: SETTINGS_AREAS.SIGN_IN,
        changes: [
            { field: FIELD, from: before.fileName, to: null },
            ...(loginLook === "image" ? [{ field: "Login page", from: "Your own image", to: "DBackup logos" }] : []),
        ],
    }, undefined, platformLogFor(ctx));
    return NextResponse.json({ success: true });
}
