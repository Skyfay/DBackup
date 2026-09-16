import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiKeyError } from "@/lib/logging/errors";

export async function GET(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    let ctx;
    try {
        ctx = await getAuthContext(await headers());
    } catch (error) {
        if (error instanceof ApiKeyError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: 401 }
            );
        }
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.HISTORY.READ);

        const { id } = await props.params;
        const { searchParams } = new URL(req.url);
        const includeLogs = searchParams.get("includeLogs") === "true";

        const execution = await prisma.execution.findUnique({
            where: { id },
            include: {
                job: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });

        if (!execution) {
            return NextResponse.json(
                { success: false, error: "Execution not found" },
                { status: 404 }
            );
        }

        // Parse metadata for progress info
        let progress: number | null = null;
        let stage: string | null = null;
        let error: string | null = null;

        if (execution.metadata) {
            try {
                const meta = JSON.parse(execution.metadata);
                progress = meta.progress ?? null;
                stage = meta.stage ?? null;
            } catch {
                // Skip if metadata can't be parsed
            }
        }

        // Extract error message from logs if execution failed
        if (execution.status === "Failed") {
            try {
                const logs = JSON.parse(execution.logs);
                const errorLog = logs.findLast?.((l: { level: string }) => l.level === "error");
                if (errorLog) {
                    error = errorLog.message || null;
                }
            } catch {
                // Skip if logs can't be parsed
            }
        }

        // Build response
        const response: Record<string, unknown> = {
            success: true,
            data: {
                id: execution.id,
                jobId: execution.jobId,
                jobName: execution.job?.name ?? null,
                type: execution.type,
                status: execution.status,
                progress,
                stage,
                startedAt: execution.startedAt.toISOString(),
                endedAt: execution.endedAt?.toISOString() ?? null,
                duration: execution.endedAt
                    ? execution.endedAt.getTime() - execution.startedAt.getTime()
                    : Date.now() - execution.startedAt.getTime(),
                size: execution.size ? Number(execution.size) : null,
                path: execution.path ?? null,
                error,
                // Set when data retention cleared the log. `logs` is then an empty array.
                logsPurgedAt: execution.logsPurgedAt?.toISOString() ?? null,
            },
        };

        // Optionally include full logs
        if (includeLogs) {
            try {
                response.data = {
                    ...(response.data as Record<string, unknown>),
                    logs: JSON.parse(execution.logs),
                };
            } catch {
                response.data = {
                    ...(response.data as Record<string, unknown>),
                    logs: [],
                };
            }
        }

        return NextResponse.json(response);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        const status = error instanceof Error && message.includes("Permission") ? 403 : 500;
        return NextResponse.json(
            { success: false, error: message },
            { status }
        );
    }
}
