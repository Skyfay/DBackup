
import { Suspense } from "react";
import { StorageClient } from "./storage-client";
import { getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

export default async function StoragePage() {
    const permissions = await getUserPermissions();
    const canDownload = permissions.includes(PERMISSIONS.STORAGE.DOWNLOAD);
    const canRestore = permissions.includes(PERMISSIONS.STORAGE.RESTORE);
    const canDelete = permissions.includes(PERMISSIONS.STORAGE.DELETE);
    // Decides whether the key recovery dialog may offer to save a typed key, since doing
    // so creates a vault profile.
    const canManageVault = permissions.includes(PERMISSIONS.VAULT.WRITE);
    const canViewHistory = permissions.includes(PERMISSIONS.HISTORY.READ);

    return (
        <>
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Storage Explorer</h1>
            <Suspense>
                <StorageClient
                    canDownload={canDownload}
                    canRestore={canRestore}
                    canDelete={canDelete}
                    canManageVault={canManageVault}
                    canViewHistory={canViewHistory}
                />
            </Suspense>
        </>
    );
}
