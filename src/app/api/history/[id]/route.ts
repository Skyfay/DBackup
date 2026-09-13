import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getExecutionHistoryRow } from "@/services/system/execution-history-service";

/**
 * One execution in the same row shape as the paged list. Lets the History page
 * open a run by id even when that run is not on the page currently loaded.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        checkPermissionWithContext(ctx, PERMISSIONS.HISTORY.READ);

        const { id } = await props.params;
        const execution = await getExecutionHistoryRow(id);
        if (!execution) {
            return NextResponse.json({ error: "Execution not found" }, { status: 404 });
        }
        return NextResponse.json({ execution });
    } catch (_error) {
        return NextResponse.json({ error: "Failed to fetch execution" }, { status: 500 });
    }
}
