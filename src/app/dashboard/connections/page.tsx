import { Suspense } from "react";
import { ConnectionsTabs } from "@/components/adapter/connections-tabs";
import { CONNECTION_TABLE_IDS, CONNECTIONS_PAGE_ID, type ConnectionCounts } from "@/components/adapter/connection-tables";
import { OAuthToastHandler } from "@/components/adapter/oauth-toast-handler";
import { getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getConnectionCounts } from "@/services/adapters/adapter-service";
import { getTablePreferences, getViewMode } from "@/services/user/preference-service";

/**
 * Everything DBackup connects to, in one place: databases, storage in either role, and
 * notification channels. Grouped by what an adapter *is* - the direction it is used in
 * belongs to the job, not to the adapter.
 */
export default async function ConnectionsPage() {
    const [permissions, user, counts] = await Promise.all([getUserPermissions(), getCurrentUserWithGroup(), getConnectionCounts()]);
    const [layouts, savedView] = user
        ? await Promise.all([getTablePreferences(user.id, Object.values(CONNECTION_TABLE_IDS)), getViewMode(user.id, CONNECTIONS_PAGE_ID)])
        : [{}, null];
    // Split joins the switch in a later release. Until then a saved split falls back to the table.
    const initialView = savedView === "cards" ? "cards" : "table";

    // Counts only for the tabs the user can open, so the page never hints at the others.
    const canViewStorage = permissions.includes(PERMISSIONS.DESTINATIONS.READ);
    const visibleCounts: ConnectionCounts = {
        databases: permissions.includes(PERMISSIONS.SOURCES.VIEW) ? counts.databases : undefined,
        sources: canViewStorage ? counts.sources : undefined,
        destinations: canViewStorage ? counts.destinations : undefined,
        notifications: permissions.includes(PERMISSIONS.NOTIFICATIONS.READ) ? counts.notifications : undefined,
    };

    return (
        <div className="space-y-4 md:space-y-6">
            <Suspense fallback={null}>
                <OAuthToastHandler />
            </Suspense>

            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Connections</h1>

            <Suspense fallback={null}>
                <ConnectionsTabs permissions={permissions} counts={visibleCounts} layouts={layouts} initialView={initialView} />
            </Suspense>
        </div>
    );
}
