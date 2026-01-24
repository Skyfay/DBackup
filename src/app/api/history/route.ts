import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

export async function GET(_req: NextRequest) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await checkPermission(PERMISSIONS.HISTORY.READ);

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
    } catch (_error) {
        return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
    }
}
