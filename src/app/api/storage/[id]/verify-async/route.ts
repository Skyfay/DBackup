import { NextRequest, NextResponse } from "next/server";
import { verificationService } from "@/services/storage/verification-service";
import { SystemTaskRunner } from "@/lib/runner/system-task-runner";
import prisma from "@/lib/prisma";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";

const log = logger.child({ route: "storage/verify-async" });

const VERIFICATION_STAGE_PROGRESS_MAP: Record<string, [number, number]> = {
    "Initializing": [0, 5],
    "Verifying":    [5, 95],
    "Completed":    [100, 100],
    "Failed":       [100, 100],
};

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const params = await props.params;

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);

        const body = await req.json();
        const { file } = body;

        if (!file || typeof file !== "string" || file.includes("..") || file.startsWith("/")) {
            return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });

        const runner = await SystemTaskRunner.create(
            "Verification",
            "Manual",
            user?.name ?? "Manual",
            VERIFICATION_STAGE_PROGRESS_MAP
        );

        // Run verification in the background — return executionId immediately.
        (async () => {
            try {
                await runner.start();
                runner.setStage("Initializing");
                runner.logEntry(`Verifying ${file}`, "info");

                runner.setStage("Verifying");
                const result = await verificationService.verifyFile(params.id, file, "manual");

                if (result.status === "passed") {
                    runner.setStage("Completed");
                    runner.logEntry("Checksum verified successfully", "success");
                    await runner.finish("Success");
                } else if (result.status === "failed") {
                    runner.setStage("Completed");
                    runner.logEntry(
                        "Checksum mismatch",
                        "error",
                        "general",
                        `Expected: ${result.expectedChecksum ?? "unknown"}\nActual:   ${result.actualChecksum ?? "unknown"}`
                    );
                    await runner.finish("Failed");
                } else {
                    const skipReasons: Record<string, string> = {
                        no_metadata: "No metadata file found",
                        no_checksum: "No checksum stored in metadata",
                        download_error: "Download failed",
                        skipped: "Already verified",
                    };
                    const reason = skipReasons[result.status] ?? result.status;
                    runner.setStage("Completed");
                    runner.logEntry(`Skipped: ${reason}`, "info");
                    await runner.finish("Success");
                }
            } catch (e: unknown) {
                log.error("Async verification failed", { file, storageConfigId: params.id }, wrapError(e));
                runner.logEntry(getErrorMessage(e), "error");
                runner.setStage("Failed");
                await runner.finish("Failed");
            }
        })();

        return NextResponse.json({ success: true, executionId: runner.id });
    } catch (error: unknown) {
        log.error("Verify-async route error", { id: params.id }, wrapError(error));
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
