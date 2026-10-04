"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";
import { PageProblem, PageProblemScreen } from "@/components/layout/page-problem";
import { Button } from "@/components/ui/button";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "app-error" });

/**
 * An error outside a page of the dashboard, like on the login page or in the frame of the
 * dashboard itself, on a page of its own.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
    useEffect(() => {
        log.error("A page failed", { digest: error.digest }, wrapError(error));
    }, [error]);

    return (
        <PageProblemScreen>
            <PageProblem
                icon={TriangleAlert}
                title="Something went wrong"
                className="w-full max-w-lg"
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
        </PageProblemScreen>
    );
}
