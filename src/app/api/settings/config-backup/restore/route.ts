import { NextRequest, NextResponse } from "next/server";
import { CONFIG_UPLOAD_MAX_BYTES, CONFIG_UPLOAD_TOO_BIG } from "@/lib/core/config-upload";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { requireConfigRestorer } from "@/lib/server/config-restore-guard";
import { keyRequiredResponse } from "@/lib/server/key-required-response";
import { readFormWithin } from "@/lib/server/upload-size";
import { checkUploadedBackup } from "@/services/config/restore-flow";

const log = logger.child({ route: "settings/config-backup/restore" });

const text = (value: FormDataEntryValue | null) => (typeof value === "string" && value ? value : null);

/**
 * Restore from a file, step one: opens and checks an uploaded configuration backup and answers
 * with what it holds and the token its Restore takes. A route rather than a Server Action, which
 * takes at most 1 MB. See `requireConfigRestorer` for who may.
 */
export async function POST(req: NextRequest) {
    const ctx = await requireConfigRestorer();
    if (ctx instanceof Response) return ctx;

    // The middleware cuts a bigger body off, so the file would arrive broken.
    const { form, tooLarge } = await readFormWithin(req, CONFIG_UPLOAD_MAX_BYTES);
    if (tooLarge) return NextResponse.json({ success: false, error: CONFIG_UPLOAD_TOO_BIG }, { status: 413 });
    const backup = form?.get("backupFile");
    if (!form || !(backup instanceof File)) return NextResponse.json({ success: false, error: "No backup file provided" }, { status: 400 });
    const meta = form.get("metaFile");

    try {
        const checked = await checkUploadedBackup(
            {
                backup,
                meta: meta instanceof File ? meta : null,
                keyHex: text(form.get("encryptionKeyHex")),
                profileId: text(form.get("encryptionProfileIdOverride")),
            },
            { userId: ctx.userId }
        );
        return NextResponse.json({ success: true, data: checked });
    } catch (error: unknown) {
        // A missing key is answerable, so it comes back as a prompt for one.
        const keyRequired = keyRequiredResponse(error);
        if (keyRequired) return keyRequired;
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        log.error("Checking an uploaded configuration backup failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The backup could not be read. The log of DBackup has the details." }, { status: 500 });
    }
}
