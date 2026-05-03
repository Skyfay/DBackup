import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { jobService } from "@/services/job-service";
import { getAuthContext, checkPermissionWithContext } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

export async function DELETE(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE);

    const params = await props.params;
    try {
        await jobService.deleteJob(params.id);
        return NextResponse.json({ success: true });
    } catch (_error) {
        return NextResponse.json({ error: "Failed to delete job" }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE);

    const params = await props.params;
    try {
        const body = await req.json();
        const { name, schedule, sourceId, databases, destinations, notificationIds, enabled, encryptionProfileId, compression, multiDbBackupType, pgCompression, notificationEvents } = body;

        const updatedJob = await jobService.updateJob(params.id, {
            name,
            schedule,
            enabled,
            sourceId,
            databases: Array.isArray(databases) ? databases : undefined,
            destinations: destinations ? destinations.map((d: { configId: string; priority?: number; retention?: any }, i: number) => ({
                configId: d.configId,
                priority: d.priority ?? i,
                retention: d.retention ? JSON.stringify(d.retention) : "{}"
            })) : undefined,
            notificationIds,
            encryptionProfileId,
            compression,
            multiDbBackupType,
            pgCompression,
            notificationEvents
        });

        return NextResponse.json(updatedJob);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to update job";
        const status = message.includes("already exists") ? 409 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
