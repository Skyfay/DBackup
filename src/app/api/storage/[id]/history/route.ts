import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getStorageHistory } from "@/services/dashboard-service";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import { permissionRefusal } from "@/lib/server/permission-refusal";

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
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
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
    const refused = permissionRefusal(error);
    if (refused) return refused;
    log.error(
      "Failed to fetch storage history",
      { configId: (await props.params).id },
      wrapError(error)
    );
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
