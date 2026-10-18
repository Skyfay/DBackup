import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext } from "@/lib/auth/access-control";
import { getTimezone } from "@/services/system/system-settings-service";

/**
 * The time zone the scheduler runs in, which the pages show schedules and next runs in.
 * Open to every signed-in caller on purpose, a session or an API key, without a permission: it is
 * one setting of the instance that every page with a schedule needs and that tells nothing about a
 * tenant.
 */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const schedulerTimezone = await getTimezone();

    return NextResponse.json({ schedulerTimezone });
}
