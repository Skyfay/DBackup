import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { getNotificationLogs } from "@/services/notification-log-service";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(await headers());
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    checkPermissionWithContext(ctx, PERMISSIONS.HISTORY.READ);

    const { searchParams } = req.nextUrl;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    const adapterId = searchParams.get("adapterId") || undefined;
    const eventType = searchParams.get("eventType") || undefined;
    const status = searchParams.get("status") || undefined;

    const result = await getNotificationLogs({
      page,
      pageSize,
      adapterId,
      eventType,
      status,
    });

    return NextResponse.json(result);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch notification logs" },
      { status: 500 }
    );
  }
}
