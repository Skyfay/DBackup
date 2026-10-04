import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { PermissionError, wrapError } from "@/lib/logging/errors";
import { getNotificationLogById } from "@/services/notifications/notification-log-service";

const log = logger.child({ route: "notification-logs/[id]" });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(await headers());
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    checkPermissionWithContext(ctx, PERMISSIONS.HISTORY.READ);

    const { id } = await params;
    const entry = await getNotificationLogById(id);

    if (!entry) {
      return NextResponse.json(
        { error: "Notification log not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(entry);
  } catch (error: unknown) {
    if (error instanceof PermissionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    log.error("Failed to fetch notification log", {}, wrapError(error));
    return NextResponse.json(
      { error: "Failed to fetch notification log" },
      { status: 500 }
    );
  }
}
