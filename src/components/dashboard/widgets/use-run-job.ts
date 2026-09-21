"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "dashboard-run-job" });

/**
 * Starts a job from the dashboard. Follows the user's preference to jump to the new run, and
 * otherwise refreshes the page so the run shows up right away.
 */
export function useRunJob() {
    const router = useRouter();
    const { autoRedirectOnJobStart } = useUserPreferences();
    const [startingJobId, setStartingJobId] = useState<string | null>(null);

    const runJob = useCallback(async (jobId: string, jobName: string) => {
        setStartingJobId(jobId);
        try {
            const res = await fetch(`/api/jobs/${jobId}/run`, { method: "POST" });
            const data = await res.json();
            if (!data.success) {
                toast.error(`Could not start ${jobName}: ${data.error ?? "unknown error"}`);
                return;
            }
            toast.success(`${jobName} started`);
            if (data.executionId && autoRedirectOnJobStart) {
                router.push(`/dashboard/history?executionId=${data.executionId}`);
            } else {
                router.refresh();
            }
        } catch (error) {
            log.error("Starting a job from the dashboard failed", { jobId }, error instanceof Error ? error : undefined);
            toast.error("The run request failed");
        } finally {
            setStartingJobId(null);
        }
    }, [router, autoRedirectOnJobStart]);

    return { runJob, startingJobId };
}
