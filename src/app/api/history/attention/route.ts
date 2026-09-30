import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getHistoryAttention } from "@/services/history/history-attention";

/** What needs a look in the runs and the notifications, for the dots of the History tabs. */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.HISTORY.READ);
    } catch {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ success: true, data: await getHistoryAttention() });
}
