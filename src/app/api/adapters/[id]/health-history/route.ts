import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ route: "adapters/health-history" });

// Helper type for date range params
export async function GET(
    req: NextRequest,
    context: { params: Promise<{ id: string }> } // In Next.js 15+ Params is a Promise
) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Permission check - Reading health history requires READ on sources OR destinations
    const hasSourcesRead = ctx.permissions.includes(PERMISSIONS.SOURCES.READ);
    const hasDestinationsRead = ctx.permissions.includes(PERMISSIONS.DESTINATIONS.READ);

    if (!ctx.isSuperAdmin && !hasSourcesRead && !hasDestinationsRead) {
        return NextResponse.json({ error: "Permission denied: sources:read or destinations:read required" }, { status: 403 });
    }

    const { id } = await context.params;
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "100");

    // Optional date range
    const from = searchParams.get("from");

    try {
        const whereClause: any = {
            adapterConfigId: id
        };

        if (from) {
            whereClause.createdAt = {
                gte: new Date(from)
            };
        }

        const history = await prisma.healthCheckLog.findMany({
            where: whereClause,
            orderBy: {
                createdAt: 'desc'
            },
            take: limit,
            select: {
                id: true,
                status: true,
                latencyMs: true,
                createdAt: true,
                error: true
            }
        });

        // Calculate summary stats
        const total = history.length;
        const uptime = total > 0
            ? (history.filter(h => h.status === 'ONLINE').length / total) * 100
            : 0;

        const avgLatency = total > 0
            ? history.reduce((acc, curr) => acc + curr.latencyMs, 0) / total
            : 0;

        return NextResponse.json({
            history,
            stats: {
                uptime: Math.round(uptime * 100) / 100,
                avgLatency: Math.round(avgLatency),
                totalChecks: total
            }
        });

    } catch (e: unknown) {
        log.error("Failed to fetch health history", { adapterId: id }, wrapError(e));
        return NextResponse.json({ error: "Failed to fetch health data" }, { status: 500 });
    }
}
