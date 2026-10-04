import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { PermissionError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { readCopyVerification, startCopyVerification } from "@/services/storage/copy-verification";

const log = logger.child({ route: "storage/verify-copies" });

const StartSchema = z.object({
    copies: z.array(z.object({
        destinationId: z.string().min(1),
        file: z.string().min(1).refine((v) => !v.includes("..") && !v.startsWith("/"), "Invalid file path"),
    })).min(1).max(50),
});

function failure(error: unknown, what: string): NextResponse {
    if (error instanceof PermissionError) return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    log.error(what, {}, wrapError(error));
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
}

/**
 * Checks copies of a backup against their checksums, one after the other in one run in History.
 * Answers with the run at once, which `GET` then follows.
 */
export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);

        const parsed = StartSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
        const { executionId } = await startCopyVerification(parsed.data.copies, user?.name ?? "Manual");
        return NextResponse.json({ success: true, data: { executionId } });
    } catch (error: unknown) {
        return failure(error, "Starting a copy verification failed");
    }
}

/** Where a check of copies stands: the run and every copy with its state and download progress. */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);

        const executionId = new URL(req.url).searchParams.get("executionId");
        if (!executionId) return NextResponse.json({ success: false, error: "Missing executionId" }, { status: 400 });

        const verification = await readCopyVerification(executionId);
        if (!verification) return NextResponse.json({ success: false, error: "No check of copies with this id" }, { status: 404 });
        return NextResponse.json({ success: true, data: verification });
    } catch (error: unknown) {
        return failure(error, "Reading a copy verification failed");
    }
}
