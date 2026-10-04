"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { JobListItem } from "@/services/jobs/job-list-service";

const log = logger.child({ hook: "use-job-list" });

/** How often the list asks again: every few seconds while a job runs, every half minute otherwise. */
const LIVE_INTERVAL_MS = 3000;
const IDLE_INTERVAL_MS = 30000;

/**
 * The jobs with how they are doing, kept fresh. Only the first load shows a skeleton, a refresh
 * keeps the rows and spins the button, and a hidden tab does not ask at all.
 */
export function useJobList() {
    const [jobs, setJobs] = useState<JobListItem[]>([]);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const loading = useRef(false);

    const load = useCallback(async (quiet: boolean) => {
        if (loading.current) return;
        loading.current = true;
        if (!quiet) setIsLoading(true);
        try {
            const res = await fetch("/api/jobs");
            const data = await res.json().catch(() => null);
            if (res.ok && Array.isArray(data)) setJobs(data as JobListItem[]);
            else if (!quiet) toast.error(data?.error || "The jobs could not be loaded.");
        } catch (error) {
            // A failed poll stays quiet, the next one tries again.
            if (!quiet) toast.error("The jobs could not be loaded.");
            log.warn("Loading the jobs failed", {}, wrapError(error));
        } finally {
            loading.current = false;
            setIsLoading(false);
            setHasLoaded(true);
        }
    }, []);

    useEffect(() => {
        void load(false);
    }, [load]);

    const live = jobs.some((job) => job.overview.live !== null);
    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | null = null;
        const start = () => {
            timer ??= setInterval(() => void load(true), live ? LIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
        };
        const stop = () => {
            if (timer) clearInterval(timer);
            timer = null;
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") return stop();
            void load(true);
            start();
        };
        if (document.visibilityState !== "hidden") start();
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            stop();
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [live, load]);

    return { jobs, setJobs, hasLoaded, isLoading, refresh: () => load(false), reload: () => load(true) };
}
