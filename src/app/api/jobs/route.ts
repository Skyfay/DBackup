import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { jobService } from "@/services/job-service";

export async function GET(req: NextRequest) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await checkPermission(PERMISSIONS.JOBS.READ);

        const jobs = await jobService.getJobs();
        return NextResponse.json(jobs);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await checkPermission(PERMISSIONS.JOBS.WRITE);

        const body = await req.json();
        const { name, schedule, sourceId, destinationId, notificationIds, enabled } = body;


        if (!name || !schedule || !sourceId || !destinationId) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const newJob = await jobService.createJob({
            name,
            schedule,
            sourceId,
            destinationId,
            notificationIds,
            enabled
        });

        return NextResponse.json(newJob, { status: 201 });
    } catch (error) {
        console.error("Create job error:", error);
        return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
    }
}
