import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { applyCheckedRestore, hasNoAccountYet } from "@/services/config/restore-flow";

const log = logger.child({ route: "setup/restore/apply" });

const bodySchema = z.object({ token: z.string().min(1) });

/**
 * Restore from a backup on the sign-up page of a new DBackup, step two.
 *
 * Intentionally public while no account exists, like step one, which it checks again: an account
 * made in between ends it. There is nobody to write an audit entry for, a copy of the database
 * carries one of its own.
 */
export async function POST(req: NextRequest) {
    if (!(await hasNoAccountYet())) {
        return NextResponse.json({ success: false, error: "DBackup has an account already. Sign in and restore under Settings." }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: "No checked backup given" }, { status: 400 });

    try {
        const applied = await applyCheckedRestore(parsed.data.token, "setup");
        return NextResponse.json({
            success: true,
            data: applied.kind === "database" ? { restarting: true } : { notes: applied.notes },
        });
    } catch (error: unknown) {
        if (error instanceof ValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        log.error("A configuration restore on the sign-up page failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: getErrorMessage(error) || "The restore failed." }, { status: 500 });
    }
}
