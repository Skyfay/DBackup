import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import {
  getNotificationFilterOptions, getNotificationLogFacets, getNotificationLogs, getNotificationStats,
} from "@/services/notifications/notification-log-service";
import { logViewOf } from "@/services/audit/log-reach";

const log = logger.child({ route: "notification-logs" });

/** The tenants of the Tenant filter of All tenants, each a tenant id. */
const TenantsSchema = z.array(z.string().min(1).max(200)).max(500);

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
    const tenants = TenantsSchema.safeParse(searchParams.getAll("tenant"));
    if (!tenants.success) {
      return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    }

    const query = {
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
      adapterId,
      channelName,
      eventType,
      status,
      executionId,
      search,
      // The Tenant filter of All tenants. Inside a tenant every entry is of that tenant anyway.
      ...(ctx.allTenants && tenants.data.length > 0 ? { tenantId: tenants.data } : {}),
    };
    const withFacets = searchParams.get("facets") === "true";
    // The History page also asks for the numbers above the list and the options of its filters.
    const withStats = searchParams.get("stats") === "true";
    // In the log of the home tenant someone of a platform group of some tenants sees no message
    // about the records of another tenant.
    const view = await logViewOf(ctx);
    const [result, facets, stats, options] = await Promise.all([
      getNotificationLogs(query, view),
      // All tenants counts the entries of each tenant for its Tenant filter.
      withFacets ? getNotificationLogFacets(query, ctx.allTenants, view) : Promise.resolve(undefined),
      withStats ? getNotificationStats(new Date(), view) : Promise.resolve(undefined),
      withStats ? getNotificationFilterOptions(view) : Promise.resolve(undefined),
    ]);

    return NextResponse.json({ ...result, ...(facets ? { facets } : {}), ...(stats ? { stats, options } : {}) });
  } catch (error: unknown) {
    if (error instanceof PermissionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    log.error("Failed to fetch notification logs", {}, wrapError(error));
    return NextResponse.json(
      { error: "Failed to fetch notification logs" },
      { status: 500 }
    );
  }
}
