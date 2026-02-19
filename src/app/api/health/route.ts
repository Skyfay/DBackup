import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Health check endpoint for Docker HEALTHCHECK and monitoring.
 * Returns 200 if the app and database are reachable, 503 otherwise.
 *
 * No authentication required — this is a public endpoint.
 */
export async function GET() {
    const start = Date.now();

    try {
        // Verify database connectivity with a lightweight query
        await prisma.$queryRaw`SELECT 1`;

        const uptime = process.uptime();
        const memUsage = process.memoryUsage();

        return NextResponse.json(
            {
                status: "healthy",
                uptime: Math.floor(uptime),
                timestamp: new Date().toISOString(),
                database: "connected",
                memory: {
                    rss: Math.round(memUsage.rss / 1024 / 1024),
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                },
                responseTime: Date.now() - start,
            },
            { status: 200 }
        );
    } catch {
        return NextResponse.json(
            {
                status: "unhealthy",
                timestamp: new Date().toISOString(),
                database: "disconnected",
                responseTime: Date.now() - start,
            },
            { status: 503 }
        );
    }
}
