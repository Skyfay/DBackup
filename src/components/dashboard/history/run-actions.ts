"use client";

import { toast } from "sonner";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ component: "RunActions" });

/** Start a job again. Returns the id of the new run, or null when it did not start. */
export async function startRun(jobId: string, name: string): Promise<string | null> {
    try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/run`, { method: "POST" });
        const body = await response.json();
        if (!body.success) {
            toast.error(`Could not start ${name}: ${body.error ?? "unknown error"}`);
            return null;
        }
        toast.success(`${name} started`);
        return typeof body.executionId === "string" ? body.executionId : null;
    } catch (error) {
        log.error("Starting a job again failed", { jobId }, wrapError(error));
        toast.error("The run request failed");
        return null;
    }
}

/** Ask a live run to stop. */
export async function cancelRun(id: string): Promise<boolean> {
    try {
        const response = await fetch(`/api/executions/${encodeURIComponent(id)}/cancel`, { method: "POST" });
        const body = await response.json();
        if (!body.success) {
            toast.error(body.error || "The run could not be cancelled");
            return false;
        }
        toast.success("The run is being cancelled");
        return true;
    } catch (error) {
        log.error("Cancelling a run failed", { id }, wrapError(error));
        toast.error("The run could not be cancelled");
        return false;
    }
}
