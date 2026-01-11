import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { scheduler } from "@/lib/scheduler";

export async function DELETE(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;
    try {
        await prisma.job.delete({
            where: { id: params.id },
        });
        await scheduler.refresh();
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Failed to delete job" }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const params = await props.params;
    try {
        const body = await req.json();
        const { name, schedule, sourceId, destinationId, notificationIds, enabled } = body;

        const updatedJob = await prisma.job.update({
            where: { id: params.id },
            data: {
                name,
                schedule,
                enabled,
                sourceId,
                destinationId,
                notifications: {
                    set: [], // Clear existing relations
                    connect: notificationIds?.map((id: string) => ({ id })) || []
                }
            },
             include: {
                source: true,
                destination: true,
                notifications: true,
            }
        });

        await scheduler.refresh();

        return NextResponse.json(updatedJob);
    } catch (error) {
        return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
    }
}
