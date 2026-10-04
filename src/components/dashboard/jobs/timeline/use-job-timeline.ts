"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { JobTimeline } from "@/services/jobs/job-timeline-types";

const log = logger.child({ hook: "use-job-timeline" });

/** Every few seconds while a run is going or waiting, every half minute otherwise. */
const LIVE_INTERVAL_MS = 5_000;
const IDLE_INTERVAL_MS = 30_000;

export interface JobTimelineState {
    data: JobTimeline | null;
    error: string | null;
    reload: () => void;
}

/**
 * The runs of every job a week back and a week ahead, while the Timeline or Upcoming view shows.
 * Both views cut their range from it, so switching a zoom never loads again.
 */
export function useJobTimeline(enabled: boolean): JobTimelineState {
    const [data, setData] = useState<JobTimeline | null>(null);
    const [error, setError] = useState<string | null>(null);
    const loading = useRef(false);

    const load = useCallback(async () => {
        if (loading.current) return;
        loading.current = true;
        try {
            const res = await fetch("/api/jobs/timeline");
            const body = await res.json().catch(() => null);
            if (res.ok && body?.success) {
                setData(body.data as JobTimeline);
                setError(null);
            } else {
                setError(body?.error || "The timeline could not be loaded.");
            }
        } catch (failure) {
            setError("The timeline could not be loaded.");
            log.warn("Loading the job timeline failed", {}, wrapError(failure));
        } finally {
            loading.current = false;
        }
    }, []);

    useEffect(() => {
        if (enabled) void load();
    }, [enabled, load]);

    const live = data?.runs.some((run) => run.status === "Running" || run.status === "Pending") ?? false;
    useVisibleInterval(() => void load(), live ? LIVE_INTERVAL_MS : IDLE_INTERVAL_MS, enabled);

    return { data, error, reload: () => void load() };
}
