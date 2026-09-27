import { Suspense } from "react";
import { RunPage } from "@/components/dashboard/history/run-page";
import { checkPermission, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function HistoryRunPage() {
    await checkPermission(PERMISSIONS.HISTORY.READ);
    const permissions = await getUserPermissions();
    const can = (permission: string) => permissions.includes(permission);

    return (
        <>
            {/* The head of the page names the run, the header bar the page. */}
            <h1 className="sr-only">Run</h1>
            <Suspense>
                <RunPage
                    access={{
                        canExecute: can(PERMISSIONS.JOBS.EXECUTE),
                        canOpenJobs: can(PERMISSIONS.JOBS.READ),
                        canOpenBackups: can(PERMISSIONS.STORAGE.READ),
                        canOpenConnections: can(PERMISSIONS.SOURCES.VIEW) || can(PERMISSIONS.DESTINATIONS.READ) || can(PERMISSIONS.NOTIFICATIONS.READ),
                    }}
                />
            </Suspense>
        </>
    );
}
