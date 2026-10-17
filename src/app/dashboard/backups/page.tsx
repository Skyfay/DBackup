import type { Metadata } from "next";

import { Suspense } from "react";
import { StorageClient } from "./storage-client";
import { BACKUPS_PAGE_ID, BACKUPS_TABLE_ID, DESTINATIONS_PAGE_ID } from "@/components/dashboard/storage/explorer/backup-tables";
import { TenantKeyed } from "@/components/tenant/tenant-keyed";
import { getViewer, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getTablePreferences, getViewMode } from "@/services/user/preference-service";
import { hasSharedDatabases } from "@/services/tenant/shared-databases";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Backups" };

const log = logger.child({ page: "backups" });

export default async function StoragePage() {
    const [permissions, user] = await Promise.all([getUserPermissions(), getViewer()]);
    const canRead = permissions.includes(PERMISSIONS.STORAGE.READ);
    const [layouts, backupsView, destinationsView, hasShared] = await Promise.all([
        user ? getTablePreferences(user.id, [BACKUPS_TABLE_ID]) : Promise.resolve({} as Awaited<ReturnType<typeof getTablePreferences>>),
        user ? getViewMode(user.id, BACKUPS_PAGE_ID) : Promise.resolve(null),
        user ? getViewMode(user.id, DESTINATIONS_PAGE_ID) : Promise.resolve(null),
        // The backups of shared databases join the list, while a server of another tenant gives
        // databases to this one. All tenants has no tenant of its own, and a failure only leaves them out.
        user?.tenantId && canRead
            ? hasSharedDatabases(user.tenantId).catch((error: unknown) => {
                log.warn("Checking for shared databases failed", { tenantId: user.tenantId }, wrapError(error));
                return false;
            })
            : Promise.resolve(false),
    ]);
    const canDownload = permissions.includes(PERMISSIONS.STORAGE.DOWNLOAD);
    const canRestore = permissions.includes(PERMISSIONS.STORAGE.RESTORE);
    const canDelete = permissions.includes(PERMISSIONS.STORAGE.DELETE);
    // Decides whether the key recovery dialog may offer to save a typed key, since doing
    // so creates a vault profile.
    const canManageVault = permissions.includes(PERMISSIONS.VAULT.WRITE);
    const canViewHistory = permissions.includes(PERMISSIONS.HISTORY.READ);
    // Back up now of a database another tenant's server gives to this one, like Run now of a job.
    const canBackUpShared = permissions.includes(PERMISSIONS.JOBS.EXECUTE);
    // The alerts belong to a destination of one tenant, so they change with the right to change its
    // destinations and only while that tenant is open, never in All tenants.
    const canEditAlerts = permissions.includes(PERMISSIONS.DESTINATIONS.WRITE) && Boolean(user?.tenantId) && !user?.allTenants;

    return (
        <>
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Backups</h1>
            <Suspense>
                {/* Mounted again when the tenant changes, so Open in a tenant shows the backups of that one at once. */}
                <TenantKeyed>
                    <StorageClient
                        canDownload={canDownload}
                        canRestore={canRestore}
                        canDelete={canDelete}
                        canManageVault={canManageVault}
                        canViewHistory={canViewHistory}
                        canEditAlerts={canEditAlerts}
                        hasShared={hasShared}
                        canBackUpShared={canBackUpShared}
                        initialLayout={layouts[BACKUPS_TABLE_ID] ?? null}
                        initialViews={{ backups: backupsView ?? "table", destinations: destinationsView ?? "table" }}
                    />
                </TenantKeyed>
            </Suspense>
        </>
    );
}
