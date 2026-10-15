import { headers } from "next/headers";
import { getAuthContext } from "@/lib/auth/access-control";
import { getAutoRedirectOnJobStart } from "@/services/user/preference-service";
import { NextResponse } from "next/server";

export async function GET() {
    const headersList = await headers();
    const ctx = await getAuthContext(headersList);

    if (!ctx) {
        return NextResponse.json({ autoRedirectOnJobStart: true }, { status: 200 });
    }

    try {
        return NextResponse.json({
            autoRedirectOnJobStart: await getAutoRedirectOnJobStart(ctx.userId),
        });
    } catch {
        return NextResponse.json({ autoRedirectOnJobStart: true }, { status: 200 });
    }
}
