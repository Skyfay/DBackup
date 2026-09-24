"use client";

import { useEffect, useState } from "react";
import type { ScheduleLoad } from "@/lib/core/schedule-conflicts";

/**
 * What the scheduler already runs, for the warning of the schedule picker. Null until it is
 * loaded and for someone without the right to read jobs, who then simply sees no warning.
 */
export function useScheduleLoad(): ScheduleLoad | null {
    const [load, setLoad] = useState<ScheduleLoad | null>(null);

    useEffect(() => {
        let active = true;
        fetch("/api/jobs/schedules")
            .then((res) => (res.ok ? res.json() : null))
            .then((body: { success?: boolean; data?: ScheduleLoad } | null) => {
                if (active && body?.success && body.data) setLoad(body.data);
            })
            .catch(() => {
                // The warning is a hint, the picker works without it.
            });
        return () => {
            active = false;
        };
    }, []);

    return load;
}
