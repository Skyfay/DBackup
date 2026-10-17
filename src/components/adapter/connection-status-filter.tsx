"use client";

import { QuickFilter } from "@/components/ui/quick-filter";
import type { AdapterConfig } from "./types";
import { isAirGapped } from "@/lib/core/air-gap";

export type StatusFilter = "all" | "online" | "issues" | "unused" | "provided";

const OPTIONS: Record<StatusFilter, { label: string; dot?: string }> = {
    all: { label: "All" },
    online: { label: "Online", dot: "bg-success" },
    issues: { label: "Issues", dot: "bg-destructive" },
    unused: { label: "Unused" },
    provided: { label: "Provided" },
};

/** Another tenant gives it to this one: a destination or a channel it shares, or a server with databases of this tenant. */
export function isProvidedRow(config: AdapterConfig): boolean {
    return Boolean(config.provided || config.sharedServer);
}

/** Whether a connection belongs in a quick filter. Issues are the degraded and offline ones. */
export function matchesStatus(config: AdapterConfig, filter: StatusFilter): boolean {
    if (filter === "all") return true;
    if (filter === "provided") return isProvidedRow(config);
    // A server of another tenant has no health checks here and no job of this tenant, so it is
    // never online, an issue or unused.
    if (config.sharedServer) return false;
    switch (filter) {
        case "online":
            return Boolean(config.lastHealthCheck) && (config.lastStatus ?? "ONLINE") === "ONLINE";
        case "issues":
            // An air-gapped destination that is not connected is away on purpose.
            return (config.lastStatus === "OFFLINE" || config.lastStatus === "DEGRADED") && !isAirGapped(config);
        case "unused": {
            const used = config.overview?.usedBy;
            return used !== undefined && used.jobs + used.templates === 0;
        }
    }
}

/** The quick filters a list offers: by health where it has one, by use, and Provided while it lists anything another tenant gives. */
export function statusFilterOptions(configs: readonly AdapterConfig[], withHealth: boolean): StatusFilter[] {
    return [
        ...(withHealth ? (["all", "online", "issues", "unused"] as const) : (["all", "unused"] as const)),
        ...(configs.some(isProvidedRow) ? (["provided"] as const) : []),
    ];
}

/** The filter that applies: a pick that is not offered any more, like Provided after the last provided row went, shows everything. */
export function effectiveStatusFilter(value: StatusFilter, configs: readonly AdapterConfig[], withHealth: boolean): StatusFilter {
    return statusFilterOptions(configs, withHealth).includes(value) ? value : "all";
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
    return (
        <QuickFilter
            aria-label="Filter by status"
            value={effectiveStatusFilter(value, configs, withHealth)}
            onChange={onChange}
            options={statusFilterOptions(configs, withHealth).map((option) => ({ value: option, ...OPTIONS[option], count: configs.filter((config) => matchesStatus(config, option)).length }))}
        />
    );
}
