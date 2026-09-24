"use client";

import { QuickFilter } from "@/components/ui/quick-filter";
import type { AdapterConfig } from "./types";

export type StatusFilter = "all" | "online" | "issues" | "unused";

const OPTIONS: Record<StatusFilter, { label: string; dot?: string }> = {
    all: { label: "All" },
    online: { label: "Online", dot: "bg-success" },
    issues: { label: "Issues", dot: "bg-destructive" },
    unused: { label: "Unused" },
};

/** Whether a connection belongs in a quick filter. Issues are the degraded and offline ones. */
export function matchesStatus(config: AdapterConfig, filter: StatusFilter): boolean {
    switch (filter) {
        case "all":
            return true;
        case "online":
            return Boolean(config.lastHealthCheck) && (config.lastStatus ?? "ONLINE") === "ONLINE";
        case "issues":
            return config.lastStatus === "OFFLINE" || config.lastStatus === "DEGRADED";
        case "unused": {
            const used = config.overview?.usedBy;
            return used !== undefined && used.jobs + used.templates === 0;
        }
    }
}

interface ConnectionStatusFilterProps {
    value: StatusFilter;
    onChange: (value: StatusFilter) => void;
    configs: AdapterConfig[];
    /** Notification channels have no health checks, so they only filter by use. */
    withHealth: boolean;
}

/** Quick filters with their counts, beside the search. */
export function ConnectionStatusFilter({ value, onChange, configs, withHealth }: ConnectionStatusFilterProps) {
    const options: StatusFilter[] = withHealth ? ["all", "online", "issues", "unused"] : ["all", "unused"];
    return (
        <QuickFilter
            aria-label="Filter by status"
            value={value}
            onChange={onChange}
            options={options.map((option) => ({ value: option, ...OPTIONS[option], count: configs.filter((config) => matchesStatus(config, option)).length }))}
        />
    );
}
