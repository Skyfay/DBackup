import type { Metadata } from "next";
import { Suspense } from "react";
import { RunPage } from "@/components/dashboard/history/run-page";
import { redirectWithoutTenant } from "@/app/dashboard/no-tenant-redirect";
import { redirectWithoutRight } from "@/app/dashboard/right-redirect";
import { cancellableRunTypes } from "@/lib/auth/run-cancel-rule";
import { PERMISSIONS } from "@/lib/auth/permissions";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Run" };

export const dynamic = "force-dynamic";

export default async function HistoryRunPage() {
    await redirectWithoutTenant();
    const viewer = await redirectWithoutRight(PERMISSIONS.HISTORY.READ);
    const permissions = viewer.permissions;
    const can = (permission: string) => permissions.includes(permission);

    return (
        <>
            {/* The head of the page names the run, the header bar the page. */}
            <h1 className="sr-only">Run</h1>
            <Suspense>
                <RunPage
                    access={{
                        canExecute: can(PERMISSIONS.JOBS.EXECUTE),
                        cancels: cancellableRunTypes(viewer),
                        canOpenJobs: can(PERMISSIONS.JOBS.READ),
                        canOpenBackups: can(PERMISSIONS.STORAGE.READ),
                        canOpenConnections: can(PERMISSIONS.SOURCES.VIEW) || can(PERMISSIONS.DESTINATIONS.READ) || can(PERMISSIONS.NOTIFICATIONS.READ),
                    }}
                />
            </Suspense>
        </>
    );
}
