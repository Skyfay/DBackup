"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizePath } from "@/services/storage/explorer-model";
import type { ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import type { BackupScope } from "./backups-list";
import { isQuickPick, SHARED_JOB_PREFIX, type QuickPick } from "./shared-runs";

/** The lists of the Backups page. */
export type ExplorerTab = "backups" | "destinations";

/** The address parameter that opens the details of a backup by its path. */
export const BACKUP_PARAM = "backup";

/** The Backups page with the details of one backup open, by its path as the list holds it. */
export const backupHref = (path: string) => `/dashboard/backups?${BACKUP_PARAM}=${encodeURIComponent(normalizePath(path))}`;

/** The backups of the databases another tenant's server gives to this one, in the list of every backup. */
export const SHARED_HREF = "/dashboard/backups?quick=shared";

/** The backups of one shared database, which the Job filter narrows the list to. */
export const sharedBackupsHref = (database: { sourceId: string; databaseName: string }) =>
    `${SHARED_HREF}&shared=${encodeURIComponent(`${database.sourceId}/${database.databaseName}`)}`;

/** The Destinations tab with the details of one destination open. */
export const destinationHref = (destinationId: string) => `/dashboard/backups?tab=destinations&destination=${encodeURIComponent(destinationId)}`;

/** Values to set in the address, null removes one. */
export type AddressUpdate = Record<string, string | string[] | null>;

/**
 * What the address of the Backups page asks for: the tab, the filters of the backups and the
 * destination whose details show. A link to the backups of a job may name the job by its name, and
 * older links name one of its destinations beside it, which becomes the destination filter. A
 * destination on its own is the one whose details show in the Destinations tab.
 *
 * `quick` is the quick filter, all, yours or shared. `shared=<sourceId>/<databaseName>` names a
 * shared database, which picks Shared with you and narrows the Job filter to it.
 */
export function useExplorerAddress(jobs: ExplorerJob[], jobsByKey: Map<string, ExplorerJob>, destinationsById: Map<string, ExplorerDestination>) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const jobParams = searchParams.getAll("job").join("\n");
    const atParams = searchParams.getAll("at").join("\n");
    const byParams = searchParams.getAll("by").join("\n");
    const destinationParam = searchParams.get("destination");
    const tabParam = searchParams.get("tab");
    const quickParam = searchParams.get("quick");
    const sharedParam = searchParams.get("shared");
    const tab: ExplorerTab = tabParam === "destinations" || (!jobParams && !sharedParam && destinationParam) ? "destinations" : "backups";
    const quick: QuickPick = isQuickPick(quickParam) ? quickParam : sharedParam ? "shared" : "all";

    const scope = useMemo<BackupScope>(() => {
        const named = jobParams ? jobParams.split("\n") : [];
        const at = atParams ? atParams.split("\n") : [];
        const jobKeys = named.map((value) => (jobsByKey.has(value) ? value : jobs.find((job) => job.kind === "job" && job.name === value)?.key ?? value));
        const sharedKey = sharedParam ? `${SHARED_JOB_PREFIX}${sharedParam}` : null;
        return {
            jobs: sharedKey && !jobKeys.includes(sharedKey) ? [...jobKeys, sharedKey] : jobKeys,
            at: tab === "backups" && destinationParam && !at.includes(destinationParam) ? [...at, destinationParam] : at,
            by: byParams ? byParams.split("\n") : [],
        };
    }, [jobParams, atParams, byParams, destinationParam, sharedParam, tab, jobs, jobsByKey]);

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

    // The quick filter a link implied stays picked once the address no longer says it, like after a
    // change of the Job filter, which takes the shared database into the job parameter.
    const keepQuick = useMemo((): AddressUpdate => (quickParam === null && quick !== "all" ? { quick } : {}), [quickParam, quick]);

    const setScope = useCallback((next: BackupScope) => {
        setParams({ ...keepQuick, job: next.jobs, at: next.at, by: next.by, destination: null, shared: null });
    }, [setParams, keepQuick]);

    const setQuick = useCallback((next: QuickPick) => {
        // All is the default, unless a shared database in the address would pick Shared with you again.
        setParams({ quick: next === "all" && !sharedParam ? null : next });
    }, [setParams, sharedParam]);

    // A new entry in the history, so Back returns to the destination.
    const showBackupsAt = useCallback((destinationId: string) => router.push(`/dashboard/backups?at=${encodeURIComponent(destinationId)}`), [router]);

    return { tab, quick, scope, picked, setParams, setScope, setQuick, showBackupsAt };
}
