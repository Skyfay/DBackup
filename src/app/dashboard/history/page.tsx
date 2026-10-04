import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { HistoryClient } from "@/components/dashboard/history/history-client";
import { runHref } from "@/components/dashboard/history/run-links";
import { checkPermission, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "History" };

export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ executionId?: string }> }) {
    await checkPermission(PERMISSIONS.HISTORY.READ);
    // Links from before a run had a page of its own, like in older notifications, still open the run.
    const { executionId } = await searchParams;
    if (executionId) redirect(runHref(executionId));

    const permissions = await getUserPermissions();
    return (
        <>
            {/* The header bar names the page. */}
            <h1 className="sr-only">History</h1>
            <Suspense>
                <HistoryClient
                    access={{
                        canExecute: permissions.includes(PERMISSIONS.JOBS.EXECUTE),
                        canOpenJobs: permissions.includes(PERMISSIONS.JOBS.READ),
                        canOpenBackups: permissions.includes(PERMISSIONS.STORAGE.READ),
                    }}
                />
            </Suspense>
        </>
    );
}
