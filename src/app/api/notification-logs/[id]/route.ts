import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { getNotificationLogById } from "@/services/notification-log-service";

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
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch notification log" },
      { status: 500 }
    );
  }
}
