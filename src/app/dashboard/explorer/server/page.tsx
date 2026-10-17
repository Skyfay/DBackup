import type { Metadata } from "next";
import { Suspense } from "react";
import { ServerPage } from "@/components/dashboard/explorer/server-page";
import { checkPermission, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { SEE_SHARING_PERMISSION, SHARE_PERMISSION } from "@/lib/tenant/sharing";
import { serverSharingOf } from "@/services/tenant/server-sharing";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Server" };

export const dynamic = "force-dynamic";

export default async function ExplorerServerPage() {
    const viewer = await checkPermission(PERMISSIONS.SOURCES.VIEW);
    const can = (permission: Permission) => hasPermissionWithContext(viewer, permission);

    // Only a tenant that shares gives databases away, only while there is another tenant to give one to, and
    // only whoever may see the shared databases sees the card, read only without the right to share.
    const sharing = await serverSharingOf(viewer.tenantId, { see: can(SEE_SHARING_PERMISSION), assign: can(SHARE_PERMISSION) });

    return (
        <>
            {/* The head of the page names the server, the header bar the page. */}
            <h1 className="sr-only">Server</h1>
            <Suspense>
                <ServerPage canOpenBackups={can(PERMISSIONS.STORAGE.READ)} sharing={sharing} />
            </Suspense>
        </>
    );
}
