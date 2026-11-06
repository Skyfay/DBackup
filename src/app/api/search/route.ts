import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/server/unauthorized";
import { headers } from "next/headers";
import { getAuthContext, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { searchRecords } from "@/services/search/search-service";
import { accountsSeenReach } from "@/services/user/account-visibility";
import type { ConnectionType, SearchScope } from "@/services/search/search-types";

/**
 * The records the global search finds, `?q=` by name. It needs no permission of its own: each kind
 * is searched only while the viewer may open the page that lists it, the jobs with jobs:read, their
 * backups with storage:read, the connections by the permission of their tab, the databases of the
 * servers with sources:view, the runs with history:read, the people, groups and API keys by the
 * permission of their tab, in All tenants the people with platform-accounts:read, the groups of the tenants whose people the viewer
 * sees and no API keys, the templates with templates:read, the encryption keys with vault:read
 * and the saved logins with vault:read and credentials:read. Someone who may see none of them gets
 * no hits.
 */
export async function GET(req: NextRequest) {
    const ctx = await getAuthContext(await headers());
    if (!ctx) return unauthorized();

    const can = (permission: Parameters<typeof hasPermissionWithContext>[1]) => hasPermissionWithContext(ctx, permission);
    const connections: ConnectionType[] = [
        ...(can(PERMISSIONS.SOURCES.VIEW) ? ["database" as const] : []),
        ...(can(PERMISSIONS.DESTINATIONS.READ) ? ["storage" as const] : []),
        ...(can(PERMISSIONS.NOTIFICATIONS.READ) ? ["notification" as const] : []),
    ];
    const scope: SearchScope = {
        jobs: can(PERMISSIONS.JOBS.READ),
        backups: can(PERMISSIONS.STORAGE.READ),
        runs: can(PERMISSIONS.HISTORY.READ),
        databases: can(PERMISSIONS.SOURCES.VIEW),
        connections,
        // In All tenants a person opens on the accounts of the platform, which need their own right.
        users: ctx.allTenants ? can(PERMISSIONS.PLATFORM.ACCOUNTS_READ) : can(PERMISSIONS.USERS.READ),
        groups: can(PERMISSIONS.GROUPS.READ),
        // The API keys tab lists the keys of one tenant, All tenants has none to open them in.
        apiKeys: !ctx.allTenants && can(PERMISSIONS.API_KEYS.READ),
        templates: can(PERMISSIONS.TEMPLATES.READ),
        keys: can(PERMISSIONS.VAULT.READ),
        // The saved logins open on the Credentials tab of the Vault, the same rule as `/api/vault/credentials`.
        credentials: can(PERMISSIONS.VAULT.READ) && can(PERMISSIONS.CREDENTIALS.READ),
    };

    // A platform admin in All tenants searches every tenant, each hit with its tenant. An account of
    // no tenant finds nothing, like someone who may see nothing.
    if (!ctx.tenantId && !ctx.allTenants) return NextResponse.json({ success: true, data: { hits: [] } });
    const query = req.nextUrl.searchParams.get("q") ?? "";
    if (!ctx.allTenants) return NextResponse.json({ success: true, data: { hits: await searchRecords(query, scope, ctx.tenantId) } });
    // In All tenants the groups of the tenants whose people the viewer sees, none without the right to see them.
    const reach = await accountsSeenReach(ctx);
    if (reach !== "all" && reach.length === 0) scope.groups = false;
    const hits = await searchRecords(query, scope, null, reach);
    return NextResponse.json({ success: true, data: { hits } });
}
