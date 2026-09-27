import { Suspense } from "react";
import { DatabaseExplorer } from "@/components/dashboard/explorer/database-explorer";
import { DATABASES_PAGE_ID } from "@/components/dashboard/explorer/explorer-ids";
import { checkPermission, getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getViewMode } from "@/services/user/preference-service";

export const dynamic = "force-dynamic";

export default async function ExplorerPage() {
    await checkPermission(PERMISSIONS.SOURCES.VIEW);
    const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUserWithGroup()]);
    const view = user ? await getViewMode(user.id, DATABASES_PAGE_ID) : null;

    return (
        <>
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Database Explorer</h1>
            <Suspense>
                <DatabaseExplorer
                    canOpenBackups={permissions.includes(PERMISSIONS.STORAGE.READ)}
                    initialView={view ?? "table"}
                />
            </Suspense>
        </>
    );
}
