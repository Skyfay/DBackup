"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { PageProblem, PageProblemScreen } from "@/components/layout/page-problem";
import { Button } from "@/components/ui/button";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import "./globals.css";

const log = logger.child({ component: "global-error" });

/**
 * An error in the root layout, the last net under every other page. It replaces the whole document,
 * so it brings the styles itself and takes the theme the viewer picked from where next-themes keeps it.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
    useEffect(() => {
        log.error("The root layout failed", { digest: error.digest }, wrapError(error));
        let theme: string | null = null;
        try {
            theme = window.localStorage.getItem("theme");
        } catch {
            // Storage may be blocked, the system decides then.
        }
        const dark = theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        document.documentElement.classList.toggle("dark", dark);
    }, [error]);

    return (
        <html lang="en" suppressHydrationWarning>
            <body className="antialiased">
                <title>DBackup</title>
                <PageProblemScreen>
                    <PageProblem
                        icon={TriangleAlert}
                        title="DBackup could not start this page"
                        className="w-full max-w-lg"
                        detail={error.digest ? `Error ID ${error.digest}` : undefined}
                        actions={
                            <Button onClick={() => retry()}>
                                <RotateCw />
                                Try again
                            </Button>
                        }
                    >
                        Try again in a moment. If it keeps failing, the log of DBackup names the cause under the error ID below.
                    </PageProblem>
                </PageProblemScreen>
            </body>
        </html>
    );
}
