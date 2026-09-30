import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { searchRecords } from "@/services/search/search-service";
import type { ConnectionType, SearchScope } from "@/services/search/search-types";

/**
 * The records the global search finds, `?q=` by name. It needs no permission of its own: each kind
 * is searched only while the viewer may open it anyway, the jobs with jobs:read, the connections by
 * the permission of their list, the databases of the servers with sources:view, the runs with
 * history:read. Someone who may see none of them gets no hits.
 */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const can = (permission: Parameters<typeof hasPermissionWithContext>[1]) => hasPermissionWithContext(ctx, permission);
    const connections: ConnectionType[] = [
        ...(can(PERMISSIONS.SOURCES.VIEW) ? ["database" as const] : []),
        ...(can(PERMISSIONS.DESTINATIONS.READ) ? ["storage" as const] : []),
        ...(can(PERMISSIONS.NOTIFICATIONS.READ) ? ["notification" as const] : []),
    ];
    const scope: SearchScope = {
        jobs: can(PERMISSIONS.JOBS.READ),
        runs: can(PERMISSIONS.HISTORY.READ),
        databases: can(PERMISSIONS.SOURCES.VIEW),
        connections,
    };

    const hits = await searchRecords(req.nextUrl.searchParams.get("q") ?? "", scope);
    return NextResponse.json({ success: true, data: { hits } });
}
