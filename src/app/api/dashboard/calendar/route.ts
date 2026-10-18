import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getCalendarData, getCalendarDataForYear } from "@/services/dashboard-service";
import { permissionRefusal } from "@/lib/server/permission-refusal";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(await headers());
  if (!ctx) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    checkPermissionWithContext(ctx, PERMISSIONS.HISTORY.READ);

    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get("year");

    // No year param = rolling last 12 months
    if (!yearParam) {
      const data = await getCalendarData(12);
      return NextResponse.json({ success: true, data });
    }

    const year = parseInt(yearParam, 10);
    if (isNaN(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ success: false, error: "Invalid year" }, { status: 400 });
    }

    const data = await getCalendarDataForYear(year);
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const refused = permissionRefusal(error);
    if (refused) return refused;
    return NextResponse.json({ success: false, error: "Failed to fetch calendar data" }, { status: 500 });
  }
}
