"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

interface DashboardRefreshProps {
  /** Whether any job is currently running */
  hasRunningJobs: boolean;
  /** Polling interval in ms (default: 3000) */
  interval?: number;
  children: React.ReactNode;
}

/**
 * Wraps dashboard content and automatically triggers a server-side re-render
 * via router.refresh() while jobs are running. Stops polling when idle.
 */
export function DashboardRefresh({
  hasRunningJobs,
  interval = 3000,
  children,
}: DashboardRefreshProps) {
  const router = useRouter();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasRunning = useRef(hasRunningJobs);

  useEffect(() => {
    // If jobs are running, start polling
    if (hasRunningJobs) {
      wasRunning.current = true;
      intervalRef.current = setInterval(() => {
        router.refresh();
      }, interval);
    }

    // If jobs just finished (were running, now stopped), do one final refresh
    if (!hasRunningJobs && wasRunning.current) {
      wasRunning.current = false;
      router.refresh();
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hasRunningJobs, interval, router]);

  return <>{children}</>;
}
