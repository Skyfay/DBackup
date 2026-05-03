import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { jobService } from "@/services/job-service";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ route: "jobs" });

export async function GET(_req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.READ);

        const jobs = await jobService.getJobs();
        return NextResponse.json(jobs);
    } catch (_error) {
        return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE);

        const body = await req.json();
        const { name, schedule, sourceId, databases, destinations, notificationIds, enabled, encryptionProfileId, compression, multiDbBackupType, pgCompression, notificationEvents } = body;

        if (!name || !schedule || !sourceId || !destinations || !Array.isArray(destinations) || destinations.length === 0) {
            return NextResponse.json({ error: "Missing required fields (name, schedule, sourceId, destinations)" }, { status: 400 });
        }

        const newJob = await jobService.createJob({
            name,
            schedule,
            sourceId,
            databases: Array.isArray(databases) ? databases : [],
            destinations: destinations.map((d: { configId: string; priority?: number; retention?: any }, i: number) => ({
                configId: d.configId,
                priority: d.priority ?? i,
                retention: d.retention ? JSON.stringify(d.retention) : "{}"
            })),
            notificationIds,
            enabled,
            encryptionProfileId,
            compression,
            multiDbBackupType,
            pgCompression,
            notificationEvents
        });

        return NextResponse.json(newJob, { status: 201 });
    } catch (error: unknown) {
        log.error("Create job error", {}, wrapError(error));
        const message = error instanceof Error ? error.message : "Failed to create job";
        const status = message.includes("already exists") ? 409 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
