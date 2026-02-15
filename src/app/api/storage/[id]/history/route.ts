import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { getStorageHistory } from "@/services/dashboard-service";
import { logger } from "@/lib/logger";
import { wrapError, getErrorMessage } from "@/lib/errors";

const log = logger.child({ route: "storage/history" });

/**
 * GET /api/storage/[id]/history?days=30
 * Returns historical storage usage snapshots for a specific adapter config.
 */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    await checkPermission(PERMISSIONS.STORAGE.READ);

    const params = await props.params;
    const url = new URL(req.url);
    const days = Math.min(
      Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1),
      365
    );

    const history = await getStorageHistory(params.id, days);

    return NextResponse.json({ success: true, data: history });
  } catch (error) {
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
