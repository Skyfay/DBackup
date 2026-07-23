import { AdapterManager } from "@/components/adapter/adapter-manager";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { OAuthToastHandler } from "@/components/adapter/oauth-toast-handler";
import { getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
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
                permissions={permissions}
                roleFilter={STORAGE_ROLES.DESTINATION}
                defaultRole={STORAGE_ROLES.DESTINATION}
            />
        </>
    )
}
