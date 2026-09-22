"use client";

import { cn } from "@/lib/utils";
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
        <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-1">
            {options.map((option) => {
                const active = option === value;
                const { label, dot } = OPTIONS[option];
                return (
                    <button
                        key={option}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(option)}
                        className={cn(
                            // Taller on phones, where a finger has to hit it.
                            "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-7",
                            active ? "border-border bg-muted text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {dot && <span className={cn("size-1.5 rounded-full", dot)} aria-hidden="true" />}
                        {label}
                        <span className="font-normal text-muted-foreground tabular-nums">
                            {configs.filter((config) => matchesStatus(config, option)).length}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
