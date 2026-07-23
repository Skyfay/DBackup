import { Suspense } from "react";
import { ConnectionsTabs } from "@/components/adapter/connections-tabs";
import { OAuthToastHandler } from "@/components/adapter/oauth-toast-handler";
import { getUserPermissions } from "@/lib/auth/access-control";

/**
 * Everything DBackup connects to, in one place: databases, storage in either role, and
 * notification channels. Grouped by what an adapter *is* - the direction it is used in
 * belongs to the job, not to the adapter.
 */
export default async function ConnectionsPage() {
    const permissions = await getUserPermissions();

    return (
        <div className="space-y-6">
            <Suspense fallback={null}>
                <OAuthToastHandler />
            </Suspense>

            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Connections</h2>
                    <p className="text-muted-foreground">Configure the databases, storage and notification channels DBackup talks to.</p>
                </div>
            </div>

            <Suspense fallback={null}>
                <ConnectionsTabs permissions={permissions} />
            </Suspense>
        </div>
    );
}
