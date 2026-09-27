import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  getNotificationFilterOptions, getNotificationLogFacets, getNotificationLogs, getNotificationStats,
} from "@/services/notifications/notification-log-service";

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
    // Repeatable filters match any of the given values.
    const adapterId = searchParams.getAll("adapterId");
    const channelName = searchParams.getAll("channel");
    const eventType = searchParams.getAll("eventType");
    const status = searchParams.getAll("status");
    const executionId = searchParams.get("executionId") || undefined;
    const search = searchParams.get("search")?.slice(0, 200) || undefined;

    const query = {
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
      adapterId,
      channelName,
      eventType,
      status,
      executionId,
      search,
    };
    const withFacets = searchParams.get("facets") === "true";
    // The History page also asks for the numbers above the list and the options of its filters.
    const withStats = searchParams.get("stats") === "true";
    const [result, facets, stats, options] = await Promise.all([
      getNotificationLogs(query),
      withFacets ? getNotificationLogFacets(query) : Promise.resolve(undefined),
      withStats ? getNotificationStats() : Promise.resolve(undefined),
      withStats ? getNotificationFilterOptions() : Promise.resolve(undefined),
    ]);

    return NextResponse.json({ ...result, ...(facets ? { facets } : {}), ...(stats ? { stats, options } : {}) });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch notification logs" },
      { status: 500 }
    );
  }
}
