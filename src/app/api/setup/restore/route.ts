import { NextRequest, NextResponse } from "next/server";
import { CONFIG_UPLOAD_MAX_BYTES, CONFIG_UPLOAD_TOO_BIG } from "@/lib/core/config-upload";
import { ValidationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { keyRequiredResponse } from "@/lib/server/key-required-response";
import { checkUploadedBackup, hasNoAccountYet } from "@/services/config/restore-flow";

const log = logger.child({ route: "setup/restore" });

const text = (value: FormDataEntryValue | null) => (typeof value === "string" && value ? value : null);

/**
 * Restore from a backup on the sign-up page of a new DBackup, step one.
 *
 * Intentionally public, and only while no account exists: it is the moment anyone who reaches the
 * page may create the first account, which grants everything too. Once an account exists it
 * answers 403 before it reads the body, and a restore goes through Settings.
 */
export async function POST(req: NextRequest) {
    if (!(await hasNoAccountYet())) {
        return NextResponse.json({ success: false, error: "DBackup has an account already. Sign in and restore under Settings." }, { status: 403 });
    }
    if (Number(req.headers.get("content-length") ?? 0) > CONFIG_UPLOAD_MAX_BYTES) {
        return NextResponse.json({ success: false, error: CONFIG_UPLOAD_TOO_BIG }, { status: 413 });
    }

    const form = await req.formData().catch(() => null);
    const backup = form?.get("backupFile");
    if (!form || !(backup instanceof File)) return NextResponse.json({ success: false, error: "No backup file provided" }, { status: 400 });
    const meta = form.get("metaFile");

    try {
        const checked = await checkUploadedBackup({ backup, meta: meta instanceof File ? meta : null, keyHex: text(form.get("encryptionKeyHex")) }, "setup");
        return NextResponse.json({ success: true, data: checked });
    } catch (error: unknown) {
        const keyRequired = keyRequiredResponse(error);
        if (keyRequired) return keyRequired;
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        log.error("Checking a configuration backup on the sign-up page failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: getErrorMessage(error) || "The backup could not be read." }, { status: 500 });
    }
}
