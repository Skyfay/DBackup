import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getNotificationLogFacets, getNotificationLogs } from "@/services/notifications/notification-log-service";

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
    const eventType = searchParams.getAll("eventType");
    const status = searchParams.getAll("status");
    const executionId = searchParams.get("executionId") || undefined;
    const search = searchParams.get("search")?.slice(0, 200) || undefined;

    const query = {
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
      adapterId,
      eventType,
      status,
      executionId,
      search,
    };
    const withFacets = searchParams.get("facets") === "true";
    const [result, facets] = await Promise.all([
      getNotificationLogs(query),
      withFacets ? getNotificationLogFacets(query) : Promise.resolve(undefined),
    ]);

    return NextResponse.json(facets ? { ...result, facets } : result);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch notification logs" },
      { status: 500 }
    );
  }
}
