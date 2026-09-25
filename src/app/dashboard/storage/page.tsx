
import { Suspense } from "react";
import { StorageClient } from "./storage-client";
import { BACKUPS_PAGE_ID, BACKUPS_TABLE_ID, DESTINATIONS_PAGE_ID } from "@/components/dashboard/storage/explorer/backup-tables";
import { getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getTablePreferences, getViewMode } from "@/services/user/preference-service";

export default async function StoragePage() {
    const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUserWithGroup()]);
    const [layouts, backupsView, destinationsView] = await Promise.all([
        user ? getTablePreferences(user.id, [BACKUPS_TABLE_ID]) : Promise.resolve({} as Awaited<ReturnType<typeof getTablePreferences>>),
        user ? getViewMode(user.id, BACKUPS_PAGE_ID) : Promise.resolve(null),
        user ? getViewMode(user.id, DESTINATIONS_PAGE_ID) : Promise.resolve(null),
    ]);
    const canDownload = permissions.includes(PERMISSIONS.STORAGE.DOWNLOAD);
    const canRestore = permissions.includes(PERMISSIONS.STORAGE.RESTORE);
    const canDelete = permissions.includes(PERMISSIONS.STORAGE.DELETE);
    // Decides whether the key recovery dialog may offer to save a typed key, since doing
    // so creates a vault profile.
    const canManageVault = permissions.includes(PERMISSIONS.VAULT.WRITE);
    const canViewHistory = permissions.includes(PERMISSIONS.HISTORY.READ);
    // The alerts of a destination are saved with the settings.
    const canEditAlerts = permissions.includes(PERMISSIONS.SETTINGS.WRITE);

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
                    canEditAlerts={canEditAlerts}
                    initialLayout={layouts[BACKUPS_TABLE_ID] ?? null}
                    initialViews={{ backups: backupsView ?? "table", destinations: destinationsView ?? "table" }}
                />
            </Suspense>
        </>
    );
}
