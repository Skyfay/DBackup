"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

interface DashboardRefreshProps {
  /** Whether any job is currently running or queued */
  hasRunningJobs: boolean;
  /** Polling interval in ms while a job runs (default: 3000) */
  interval?: number;
  /** Polling interval in ms while nothing runs, so a scheduled run shows up without a reload (default: 30000) */
  idleInterval?: number;
  children: React.ReactNode;
}

/**
 * Wraps dashboard content and re-renders it on the server via router.refresh(): every few seconds
 * while a job runs, every half minute otherwise. A hidden tab does not poll, and catches up as soon
 * as it is visible again.
 */
export function DashboardRefresh({
  hasRunningJobs,
  interval = 3000,
  idleInterval = 30000,
  children,
}: DashboardRefreshProps) {
  const router = useRouter();
  const wasRunning = useRef(hasRunningJobs);

  useEffect(() => {
    // A run that just ended shows its outcome right away instead of at the next idle tick.
    if (!hasRunningJobs && wasRunning.current) router.refresh();
    wasRunning.current = hasRunningJobs;

    const delay = hasRunningJobs ? interval : idleInterval;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      timer ??= setInterval(() => router.refresh(), delay);
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
      router.refresh();
      start();
    };

    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hasRunningJobs, interval, idleInterval, router]);

  return <>{children}</>;
}
