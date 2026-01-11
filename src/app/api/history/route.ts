import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
    try {
        const executions = await prisma.execution.findMany({
            include: {
                job: {
                    select: { name: true }
                }
            },
            orderBy: { startedAt: 'desc' },
            take: 100
        });
        return NextResponse.json(executions);
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
    }
}
