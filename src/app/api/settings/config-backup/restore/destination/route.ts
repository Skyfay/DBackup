import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { requireConfigRestorer } from "@/lib/server/config-restore-guard";
import { keyRequiredResponse } from "@/lib/server/key-required-response";
import { checkStoredBackup, keyOverride } from "@/services/config/restore-flow";

const log = logger.child({ route: "settings/config-backup/restore/destination" });

const bodySchema = z.object({
    destinationId: z.string().min(1),
    file: z.string().min(1),
    keyHex: z.string().optional(),
    profileId: z.string().optional(),
});

/**
 * Step one for a configuration backup at a destination, as the Backups page opens it: reads and
 * checks the file on the server, so no upload limit applies. See `requireConfigRestorer` for who may.
 */
export async function POST(req: NextRequest) {
    const ctx = await requireConfigRestorer();
    if (ctx instanceof NextResponse) return ctx;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const { destinationId, file, keyHex, profileId } = parsed.data;

    try {
        const checked = await checkStoredBackup(destinationId, file, keyOverride(keyHex, profileId), { userId: ctx.userId });
        return NextResponse.json({ success: true, data: checked });
    } catch (error: unknown) {
        const keyRequired = keyRequiredResponse(error);
        if (keyRequired) return keyRequired;
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        log.error("Checking a configuration backup at a destination failed", { destinationId }, wrapError(error));
        return NextResponse.json({ success: false, error: getErrorMessage(error) || "The backup could not be read." }, { status: 500 });
    }
}
