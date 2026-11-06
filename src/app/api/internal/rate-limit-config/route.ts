import { NextRequest, NextResponse } from "next/server";
import { getRateLimitConfig } from "@/lib/rate-limit/server";
import { hasInternalToken } from "@/lib/rate-limit/internal-token";

/**
 * Internal endpoint for the Edge Runtime middleware to fetch rate limit
 * configuration. This route runs in the Node.js runtime and can read
 * from the database via Prisma.
 *
 * No session or API key: only the middleware of this server reads it, with the token of the
 * instance from `src/lib/rate-limit/internal-token.ts`. Anyone else is answered 404, as if the
 * route did not exist. It is excluded from the middleware matching.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    if (!(await hasInternalToken(req.headers))) return new NextResponse(null, { status: 404 });
    const config = await getRateLimitConfig();
    return NextResponse.json(config);
}
