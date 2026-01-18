import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { jobService } from "@/services/job-service";

export async function DELETE(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        await jobService.deleteJob(params.id);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Failed to delete job" }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    try {
        const body = await req.json();
        const { name, schedule, sourceId, destinationId, notificationIds, enabled, encryptionProfileId } = body;

        const updatedJob = await jobService.updateJob(params.id, {
            name,
            schedule,
            enabled,
            sourceId,
            destinationId,
            notificationIds,
            encryptionProfileId
        });

        return NextResponse.json(updatedJob);
    } catch (error) {
        return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
    }
}
