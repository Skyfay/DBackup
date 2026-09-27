import { NextResponse } from "next/server";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

/** How many runs and notifications the History page holds, for the counts on its tabs. */
export async function GET() {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.HISTORY.READ);
    } catch {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    const [runs, notifications] = await Promise.all([prisma.execution.count(), prisma.notificationLog.count()]);
    return NextResponse.json({ success: true, data: { runs, notifications } });
}
