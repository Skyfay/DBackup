import { NextResponse } from "next/server";
import { getRateLimitConfig } from "@/lib/rate-limit";

/**
 * Internal endpoint for the Edge Runtime middleware to fetch rate limit
 * configuration. This route runs in the Node.js runtime and can read
 * from the database via Prisma.
 *
 * No auth required — this endpoint is excluded from middleware matching
 * and only consumed by the middleware itself.
 */
export const dynamic = "force-dynamic";

export async function GET() {
    const config = await getRateLimitConfig();
    return NextResponse.json(config);
}
