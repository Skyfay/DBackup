import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUserWithGroup } from "@/lib/auth/access-control";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ValidationError } from "@/lib/logging/errors";
import { auditService } from "@/services/audit-service";
import { AVATAR_MAX_BYTES, removeAvatar, saveAvatar } from "@/services/user/avatar-service";

const FIELD = "Picture";

/**
 * A new picture of the signed-in person, `file` in a form, in place of the one before. A route
 * rather than a Server Action, since an action takes one megabyte at most and a photo is often more.
 *
 * @no-permission-required Self-service: the own picture of a signed-in session, never of an API key.
 */
export async function POST(req: NextRequest) {
    const user = await getCurrentUserWithGroup();
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "Pick a picture to upload." }, { status: 400 });
    if (file.size > AVATAR_MAX_BYTES) return NextResponse.json({ success: false, error: "The picture is larger than 5 MB." }, { status: 400 });

    try {
        const url = await saveAvatar(user.id, new Uint8Array(await file.arrayBuffer()));
        await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, {
            name: user.name,
            changes: [{ field: FIELD, from: user.image ? "A picture" : null, to: "A new picture" }],
        }, user.id);
        revalidatePath("/dashboard", "layout");
        return NextResponse.json({ success: true, data: { url } });
    } catch (error: unknown) {
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        throw error;
    }
}

/**
 * Removes the picture of the signed-in person, who shows with initials again.
 *
 * @no-permission-required Self-service: the own picture of a signed-in session, never of an API key.
 */
export async function DELETE() {
    const user = await getCurrentUserWithGroup();
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (!user.image) return NextResponse.json({ success: true });

    await removeAvatar(user.id);
    await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, {
        name: user.name,
        changes: [{ field: FIELD, from: "A picture", to: null }],
    }, user.id);
    revalidatePath("/dashboard", "layout");
    return NextResponse.json({ success: true });
}
