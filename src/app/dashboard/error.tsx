"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";
import { PageProblem } from "@/components/layout/page-problem";
import { Button } from "@/components/ui/button";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "dashboard-error" });

/**
 * A page of the dashboard that failed, shown inside the frame, so the sidebar still leads to every
 * other page. The message of an error on the server stays there, its id finds it in the log.
 */
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
    useEffect(() => {
        log.error("A page of the dashboard failed", { digest: error.digest }, wrapError(error));
    }, [error]);

    return (
        <PageProblem
            icon={TriangleAlert}
            title="This page could not be loaded"
            detail={error.digest ? `Error ID ${error.digest}` : undefined}
            actions={
                <>
                    <Button onClick={() => retry()}>
                        <RotateCw />
                        Try again
                    </Button>
                    <Button variant="outline" asChild>
                        <Link href="/dashboard">Go to the overview</Link>
                    </Button>
                </>
            }
        >
            Try again. If it keeps failing, the log of DBackup names the cause under the error ID below.
        </PageProblem>
    );
}
