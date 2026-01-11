import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { scheduler } from "@/lib/scheduler";

export async function GET(req: NextRequest) {
    try {
        const jobs = await prisma.job.findMany({
            include: {
                source: true,
                destination: true,
                notifications: true,
            },
            orderBy: { createdAt: 'desc' }
        });
        return NextResponse.json(jobs);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { name, schedule, sourceId, destinationId, notificationIds, enabled } = body;

        if (!name || !schedule || !sourceId || !destinationId) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const newJob = await prisma.job.create({
            data: {
                name,
                schedule,
                sourceId,
                destinationId,
                enabled: enabled !== undefined ? enabled : true,
                notifications: {
                    connect: notificationIds?.map((id: string) => ({ id })) || []
                }
            },
            include: {
                source: true,
                destination: true,
                notifications: true,
            }
        });

        // Refresh scheduler to pick up the new job
        await scheduler.refresh();

        return NextResponse.json(newJob, { status: 201 });
    } catch (error) {
        console.error("Create job error:", error);
        return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
    }
}
