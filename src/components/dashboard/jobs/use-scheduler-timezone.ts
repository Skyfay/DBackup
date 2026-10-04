"use client";

import { useEffect, useState } from "react";

/**
 * The time zone the scheduler runs jobs in. That is the system setting, not the zone of the
 * user. Null until it is known.
 */
export function useSchedulerTimezone(): string | null {
    const [timezone, setTimezone] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/system/timezone")
            .then((res) => res.json())
            .then((data: { schedulerTimezone?: string }) => setTimezone(data.schedulerTimezone || "UTC"))
            .catch(() => {
                // Without it the field only leaves out the hint.
            });
    }, []);

    return timezone;
}
