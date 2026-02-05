"use client";

import { AlertTriangle, Clock, X } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DemoBannerProps {
  /** Reset interval in minutes */
  resetInterval?: number;
  /** Custom message to display */
  message?: string;
  /** Whether the banner can be dismissed */
  dismissible?: boolean;
  /** Position of the banner */
  position?: "top" | "bottom";
}

/**
 * Banner displayed when demo mode is active.
 * Shows a warning that the instance resets periodically.
 *
 * This component is client-side only and should be rendered
 * conditionally based on the NEXT_PUBLIC_DEMO_MODE env var.
 *
 * @example
 * ```tsx
 * {process.env.NEXT_PUBLIC_DEMO_MODE === "true" && <DemoBanner />}
 * ```
 */
export function DemoBanner({
  resetInterval = 10,
  message,
  dismissible = true,
  position = "top",
}: DemoBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  // Calculate time until next reset (based on 10-minute intervals from epoch)
  const calculateTimeLeft = () => {
    const now = Date.now();
    const intervalMs = resetInterval * 60 * 1000;
    const nextReset = Math.ceil(now / intervalMs) * intervalMs;
    return Math.max(0, Math.floor((nextReset - now) / 1000));
  };

  // Initialize with calculated value, update via interval
  const [timeLeft, setTimeLeft] = useState<number>(calculateTimeLeft);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetInterval]);

  if (dismissed) return null;

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const displayMessage =
    message ||
    `Demo Mode – This instance resets every ${resetInterval} minutes. Some actions are restricted.`;

  return (
    <div
      className={cn(
        "w-full bg-amber-500/90 text-amber-950 px-4 py-2 flex items-center justify-center gap-3 text-sm font-medium",
        position === "top" ? "fixed top-0 left-0 right-0 z-50" : "fixed bottom-0 left-0 right-0 z-50"
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{displayMessage}</span>
      <span className="flex items-center gap-1 bg-amber-600/30 px-2 py-0.5 rounded text-xs">
        <Clock className="h-3 w-3" />
        {formatTime(timeLeft)}
      </span>
      {dismissible && (
        <button
          onClick={() => setDismissed(true)}
          className="ml-2 p-1 hover:bg-amber-600/30 rounded transition-colors"
          aria-label="Dismiss banner"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
