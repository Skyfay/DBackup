import type { Metadata } from "next";
import { Suspense } from "react";
import { DatabasePage } from "@/components/dashboard/explorer/database-page";
import { checkPermission, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Database" };

export const dynamic = "force-dynamic";

export default async function ExplorerDatabasePage() {
    await checkPermission(PERMISSIONS.SOURCES.VIEW);
    const permissions = await getUserPermissions();

    return (
        <>
            {/* The head of the page names the database, the header bar the page. */}
            <h1 className="sr-only">Database</h1>
            <Suspense>
                <DatabasePage
                    canBrowse={permissions.includes(PERMISSIONS.SOURCES.READ)}
                    canOpenBackups={permissions.includes(PERMISSIONS.STORAGE.READ)}
                />
            </Suspense>
        </>
    );
}
