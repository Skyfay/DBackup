"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import type { BackupScope } from "./backups-list";

export type ExplorerTab = "backups" | "destinations";

/** Values to set in the address, null removes one. */
export type AddressUpdate = Record<string, string | string[] | null>;

/**
 * What the address of the Storage Explorer asks for: the tab, the filters of the backups and the
 * destination whose details show. A link to the backups of a job may name the job by its name, and
 * older links name one of its destinations beside it, which becomes the destination filter. A
 * destination on its own is the one whose details show in the Destinations tab.
 */
export function useExplorerAddress(jobs: ExplorerJob[], jobsByKey: Map<string, ExplorerJob>, destinationsById: Map<string, ExplorerDestination>) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const jobParams = searchParams.getAll("job").join("\n");
    const atParams = searchParams.getAll("at").join("\n");
    const byParams = searchParams.getAll("by").join("\n");
    const destinationParam = searchParams.get("destination");
    const tab: ExplorerTab = searchParams.get("tab") === "destinations" || (!jobParams && destinationParam) ? "destinations" : "backups";

    const scope = useMemo<BackupScope>(() => {
        const named = jobParams ? jobParams.split("\n") : [];
        const at = atParams ? atParams.split("\n") : [];
        return {
            jobs: named.map((value) => (jobsByKey.has(value) ? value : jobs.find((job) => job.kind === "job" && job.name === value)?.key ?? value)),
            at: tab === "backups" && destinationParam && !at.includes(destinationParam) ? [...at, destinationParam] : at,
            by: byParams ? byParams.split("\n") : [],
        };
    }, [jobParams, atParams, byParams, destinationParam, tab, jobs, jobsByKey]);

    const picked = tab === "destinations" && destinationParam && destinationsById.has(destinationParam) ? destinationParam : null;

    const setParams = useCallback((next: AddressUpdate) => {
        const params = new URLSearchParams(searchParams.toString());
        for (const [key, value] of Object.entries(next)) {
            params.delete(key);
            if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
            else if (value !== null) params.set(key, value);
        }
        const query = params.toString();
        router.replace(query ? `/dashboard/storage?${query}` : "/dashboard/storage", { scroll: false });
    }, [router, searchParams]);

    // A new entry in the history, so Back returns to the destination.
    const showBackupsAt = useCallback((destinationId: string) => router.push(`/dashboard/storage?at=${encodeURIComponent(destinationId)}`), [router]);

    return { tab, scope, picked, setParams, showBackupsAt };
}
