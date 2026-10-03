"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `tick` every `ms` while the page is visible and `enabled`, so a hidden browser tab asks the
 * server nothing. Coming back to the tab runs it once at once and goes on from there, like
 * `DashboardRefresh` does for the Overview.
 */
export function useVisibleInterval(tick: () => void, ms: number, enabled = true) {
    // The newest tick, so a new function each render neither restarts the timer nor runs a stale one.
    const latest = useRef(tick);
    useEffect(() => {
        latest.current = tick;
    }, [tick]);

    useEffect(() => {
        if (!enabled) return;
        let timer: ReturnType<typeof setInterval> | null = null;
        const start = () => {
            timer ??= setInterval(() => latest.current(), ms);
        };
        const stop = () => {
            if (timer) clearInterval(timer);
            timer = null;
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                stop();
                return;
            }
            latest.current();
            start();
        };

        if (document.visibilityState !== "hidden") start();
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            stop();
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [ms, enabled]);
}
