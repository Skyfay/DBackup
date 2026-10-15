"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizePath } from "@/services/storage/explorer-model";
import type { ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import type { BackupScope } from "./backups-list";

/** The lists of the Backups page. Shared with you only shows while another tenant shares a database with this one. */
export type ExplorerTab = "backups" | "destinations" | "shared";

/** The address parameter that opens the details of a backup by its path. */
export const BACKUP_PARAM = "backup";

/** The Backups page with the details of one backup open, by its path as the list holds it. */
export const backupHref = (path: string) => `/dashboard/backups?${BACKUP_PARAM}=${encodeURIComponent(normalizePath(path))}`;

/** The tab Shared with you, the backups of the databases another tenant's server gives to this one. */
export const SHARED_HREF = "/dashboard/backups?tab=shared";

/** The Destinations tab with the details of one destination open. */
export const destinationHref = (destinationId: string) => `/dashboard/backups?tab=destinations&destination=${encodeURIComponent(destinationId)}`;

/** Values to set in the address, null removes one. */
export type AddressUpdate = Record<string, string | string[] | null>;

/**
 * What the address of the Backups page asks for: the tab, the filters of the backups and the
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
    const tabParam = searchParams.get("tab");
    const tab: ExplorerTab = tabParam === "shared" ? "shared" : tabParam === "destinations" || (!jobParams && destinationParam) ? "destinations" : "backups";

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
        router.replace(query ? `/dashboard/backups?${query}` : "/dashboard/backups", { scroll: false });
    }, [router, searchParams]);

    // A new entry in the history, so Back returns to the destination.
    const showBackupsAt = useCallback((destinationId: string) => router.push(`/dashboard/backups?at=${encodeURIComponent(destinationId)}`), [router]);

    return { tab, tabParam, scope, picked, setParams, showBackupsAt };
}
