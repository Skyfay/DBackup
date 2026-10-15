import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { findDomainProvider } from "@/services/auth/login-page-service";

const log = logger.child({ route: "login-provider" });

const bodySchema = z.object({ domain: z.string().trim().min(1).max(253) });

/**
 * Which sign-in provider the domain of an email goes to, for the login page while someone types.
 *
 * Public on purpose: nobody is signed in on the login page. It answers for one domain at a time
 * with the name and logo of the provider and never a tenant, so the page does not list every
 * customer's domain to whoever opens it. The domain comes in the body, kept out of logs of
 * addresses, and the mutation rate limit of the middleware slows down anyone guessing domains.
 * better-auth's own sign-in answers the same question for an email.
 */
export async function POST(request: NextRequest) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });

    try {
        const provider = await findDomainProvider(parsed.data.domain);
        return NextResponse.json({ success: true, data: { provider } });
    } catch (error: unknown) {
        log.error("Looking up the provider of a domain failed", {}, wrapError(error));
        return NextResponse.json({ success: false, error: "The provider could not be looked up" }, { status: 500 });
    }
}
