import type { Metadata } from "next";
import { Suspense } from "react";
import { ServerPage } from "@/components/dashboard/explorer/server-page";
import { checkPermission, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Server" };

export const dynamic = "force-dynamic";

export default async function ExplorerServerPage() {
    await checkPermission(PERMISSIONS.SOURCES.VIEW);
    const permissions = await getUserPermissions();

    return (
        <>
            {/* The head of the page names the server, the header bar the page. */}
            <h1 className="sr-only">Server</h1>
            <Suspense>
                <ServerPage canOpenBackups={permissions.includes(PERMISSIONS.STORAGE.READ)} />
            </Suspense>
        </>
    );
}
