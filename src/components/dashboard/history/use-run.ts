"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import type { RunDetail } from "@/services/history/run-types";

const log = logger.child({ component: "useRun" });
const LIVE_POLL_MS = 2000;
/** Speed samples kept for the chart of a live upload, about two minutes. */
const SAMPLES = 60;

export interface SpeedSample {
    at: number;
    /** Bytes a second since the sample before. */
    bytesPerSecond: number;
}

function isLive(run: RunDetail | null): boolean {
    return run?.status === "Running" || run?.status === "Pending";
}

/**
 * One run for its page, asked again every two seconds while it is live. The speed of the upload
 * is measured here from one answer to the next, so the server stores no samples.
 */
export function useRun(id: string | null) {
    const [run, setRun] = useState<RunDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [speed, setSpeed] = useState<SpeedSample[]>([]);
    const last = useRef<{ at: number; bytes: number; configId: string } | null>(null);

    const fetchRun = useCallback(async () => {
        if (!id) return;
        try {
            const response = await fetch(`/api/history/runs/${encodeURIComponent(id)}`);
            const body = await response.json();
            if (!response.ok || !body.success) {
                setError(body.error ?? "The run could not be loaded.");
                return;
            }
            const next = body.data as RunDetail;
            setRun(next);
            setError(null);
            const uploading = next.uploads.find((upload) => upload.state === "uploading" && upload.bytes !== null);
            if (uploading) {
                const now = Date.now();
                const previous = last.current;
                if (previous && previous.configId === uploading.configId && now > previous.at && uploading.bytes! >= previous.bytes) {
                    const sample = { at: now, bytesPerSecond: ((uploading.bytes! - previous.bytes) * 1000) / (now - previous.at) };
                    setSpeed((samples) => [...samples, sample].slice(-SAMPLES));
                } else if (previous?.configId !== uploading.configId) {
                    setSpeed([]);
                }
                last.current = { at: now, bytes: uploading.bytes!, configId: uploading.configId };
            }
        } catch (caught) {
            log.error("Loading a run failed", { id }, wrapError(caught));
            setError("The run could not be loaded.");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        setRun(null);
        setLoading(true);
        setSpeed([]);
        last.current = null;
        void fetchRun();
    }, [fetchRun]);

    const live = isLive(run);
    useEffect(() => {
        if (!live) return;
        const timer = setInterval(() => {
            if (typeof document !== "undefined" && document.hidden) return;
            void fetchRun();
        }, LIVE_POLL_MS);
        return () => clearInterval(timer);
    }, [live, fetchRun]);

    return { run, error, loading, speed, reload: fetchRun };
}
