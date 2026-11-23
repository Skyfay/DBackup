import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getStorageHistory } from "@/services/dashboard-service";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { serviceRefusal } from "@/lib/server/permission-refusal";

const log = logger.child({ route: "storage/history" });

/**
 * GET /api/storage/[id]/history?days=30
 * Returns historical storage usage snapshots for a specific adapter config.
 */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(await headers());

  if (!ctx) {
    return unauthorized();
  }

  try {
    checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.READ);

    const params = await props.params;
    const url = new URL(req.url);
    const days = Math.min(
      Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1),
      365
    );

    const history = await getStorageHistory(params.id, days);

    return NextResponse.json({ success: true, data: history });
  } catch (error) {
    const refused = serviceRefusal(error);
    if (refused) return refused;
    log.error(
      "Failed to fetch storage history",
      { configId: (await props.params).id },
      wrapError(error)
    );
    return NextResponse.json(
      { success: false, error: "The history of the destination could not be loaded. The log of DBackup has the details." },
      { status: 500 }
    );
  }
}
