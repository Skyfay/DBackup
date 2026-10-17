import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectionsTabs } from "@/components/adapter/connections-tabs";
import { CONNECTION_TABLE_IDS, CONNECTIONS_PAGE_ID, type ConnectionAttention } from "@/components/adapter/connection-tables";
import { OAuthToastHandler } from "@/components/adapter/oauth-toast-handler";
import { ConnectionSharingProvider } from "@/components/adapter/connection-sharing";
import { WithdrawnNotes } from "@/components/adapter/connection-withdrawn";
import { TenantKeyed } from "@/components/tenant/tenant-keyed";
import { getViewer, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getConnectionAttention } from "@/services/adapters/adapter-service";
import { SEE_SHARING_PERMISSION, SHARE_PERMISSION } from "@/lib/tenant/sharing";
import { serverSharingOf } from "@/services/tenant/server-sharing";
import { withdrawnConnections } from "@/services/sharing/withdrawn";
import { getTablePreferences, getViewMode } from "@/services/user/preference-service";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Connections" };

/**
 * Everything DBackup connects to, in one place: databases, storage in either role, and
 * notification channels. Grouped by what an adapter *is* - the direction it is used in
 * belongs to the job, not to the adapter.
 */
export default async function ConnectionsPage() {
    const [permissions, user, attention] = await Promise.all([getUserPermissions(), getViewer(), getConnectionAttention()]);
    const [layouts, savedView, sharing, withdrawn] = user
        ? await Promise.all([
            getTablePreferences(user.id, Object.values(CONNECTION_TABLE_IDS)),
            getViewMode(user.id, CONNECTIONS_PAGE_ID),
            // The card Shared with tenants in the details of a database, like on the page of its server.
            serverSharingOf(user.tenantId, { see: permissions.includes(SEE_SHARING_PERMISSION), assign: permissions.includes(SHARE_PERMISSION) }),
            // What other tenants stopped sharing with this one lately. In All tenants nothing.
            user.tenantId ? withdrawnConnections(user.tenantId) : [],
        ])
        : [{}, null, null, []];
    const initialView = savedView ?? "table";

    // Dots only for the tabs the user can open, so the page never hints at the others.
    const canViewStorage = permissions.includes(PERMISSIONS.DESTINATIONS.READ);
    const visibleAttention: ConnectionAttention = {
        databases: permissions.includes(PERMISSIONS.SOURCES.VIEW) ? attention.databases : undefined,
        sources: canViewStorage ? attention.sources : undefined,
        destinations: canViewStorage ? attention.destinations : undefined,
        notifications: permissions.includes(PERMISSIONS.NOTIFICATIONS.READ) ? attention.notifications : undefined,
    };
    // A note only about a kind the user may list.
    const notes = withdrawn.filter((note) => (note.kind === "destination" ? canViewStorage : permissions.includes(PERMISSIONS.NOTIFICATIONS.READ)));

    return (
        <div className="space-y-4 md:space-y-6">
            <Suspense fallback={null}>
                <OAuthToastHandler />
            </Suspense>

            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Connections</h1>

            {notes.length > 0 && <WithdrawnNotes notes={notes} />}

            <Suspense fallback={null}>
                <TenantKeyed>
                    <ConnectionSharingProvider value={sharing}>
                        <ConnectionsTabs permissions={permissions} attention={visibleAttention} layouts={layouts} initialView={initialView} />
                    </ConnectionSharingProvider>
                </TenantKeyed>
            </Suspense>
        </div>
    );
}
