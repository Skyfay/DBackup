"use client";

import { QuickFilter } from "@/components/ui/quick-filter";
import type { ExplorerDestination } from "@/services/storage/explorer-types";

/** Every destination, the tenant's own ones, or the ones another tenant shares with it. */
export type DestinationSource = "all" | "own" | "provided";

const LABELS: Record<DestinationSource, string> = { all: "All", own: "Yours", provided: "Provided" };
const SOURCES: DestinationSource[] = ["all", "own", "provided"];

export function matchesDestinationSource(destination: Pick<ExplorerDestination, "provider">, source: DestinationSource): boolean {
    if (source === "all") return true;
    return source === "provided" ? Boolean(destination.provider) : !destination.provider;
}

/** All, Yours and Provided with their counts, after the filters of the list, only while some destination is provided. */
export function DestinationSourceFilter({ value, onChange, destinations }: { value: DestinationSource; onChange: (value: DestinationSource) => void; destinations: ExplorerDestination[] }) {
    return (
        <QuickFilter
            aria-label="Filter by whose destination it is"
            value={value}
            onChange={onChange}
            options={SOURCES.map((source) => ({ value: source, label: LABELS[source], count: destinations.filter((destination) => matchesDestinationSource(destination, source)).length }))}
        />
    );
}
