import { AdapterManager } from "@/components/adapter/adapter-manager";
import { OAuthToastHandler } from "@/components/adapter/oauth-toast-handler";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { Suspense } from "react";

export default async function DestinationsPage() {
    const permissions = await getUserPermissions();
    const canManage = permissions.includes(PERMISSIONS.DESTINATIONS.WRITE);

    return (
        <>
            <Suspense fallback={null}>
                <OAuthToastHandler />
            </Suspense>
            <AdapterManager
                type="storage"
                title="Destinations"
                description="Configure where your backups should be stored."
                canManage={canManage}
            />
        </>
    )
}
