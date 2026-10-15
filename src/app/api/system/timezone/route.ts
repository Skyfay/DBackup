import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext } from "@/lib/auth/access-control";
import { getTimezone } from "@/services/system/system-settings-service";

export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const schedulerTimezone = await getTimezone();

    return NextResponse.json({ schedulerTimezone });
}
