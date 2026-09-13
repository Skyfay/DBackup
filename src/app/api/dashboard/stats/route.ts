import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getDashboardStats, getStorageVolumeCacheAge } from "@/services/dashboard-service";
import { logger } from "@/lib/logging/logger";
import { wrapError, ApiKeyError, PermissionError } from "@/lib/logging/errors";

const log = logger.child({ route: "dashboard/stats" });

/**
 * GET /api/dashboard/stats
 * Returns the figures from the dashboard overview cards, for homepage widgets and monitoring.
 *
 * Guarded by its own permission rather than jobs, history or storage read access, so a key
 * handed to a widget only ever sees totals and cannot list anything.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await getAuthContext(await headers());
  } catch (error) {
    if (error instanceof ApiKeyError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!ctx) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    checkPermissionWithContext(ctx, PERMISSIONS.DASHBOARD.READ);

    // Sequential on purpose. On a cold cache the stats call fills it, and the timestamp
    // read afterwards has to describe that refresh.
    const stats = await getDashboardStats();
    const storageUpdatedAt = await getStorageVolumeCacheAge();

    return NextResponse.json({ success: true, data: { ...stats, storageUpdatedAt } });
  } catch (error: unknown) {
    if (error instanceof PermissionError) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    log.error("Failed to fetch dashboard stats", {}, wrapError(error));
    return NextResponse.json(
      { success: false, error: "Failed to fetch dashboard stats" },
      { status: 500 }
    );
  }
}
