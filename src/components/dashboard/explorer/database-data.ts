"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { logger } from "@/lib/logging/logger";
import type { DatabaseOverview, DatabaseRunsData } from "@/services/databases/database-explorer-types";
import { expandRuns } from "./database-model";

const log = logger.child({ component: "database-explorer" });

async function fetchData<T>(url: string, fallback: string): Promise<T> {
    const res = await fetch(url);
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.success) throw new Error(payload?.error ?? fallback);
    return payload.data as T;
}

interface Loaded<T> {
    url: string;
    data: T | null;
    error: string | null;
}

/**
 * Loads a view of the Database Explorer. A new address starts empty, so the page shows its
 * skeleton, while `reload` keeps what is shown until the fresh answer is in.
 */
export function useDatabaseData<T>(url: string | null, fallback = "The databases could not be loaded.") {
    const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
    const [version, setVersion] = useState(0);
    const [reloading, setReloading] = useState(false);

    useEffect(() => {
        if (!url) return;
        let ignore = false;
        fetchData<T>(url, fallback)
            .then((data) => {
                if (!ignore) setLoaded({ url, data, error: null });
            })
            .catch((error: unknown) => {
                if (ignore) return;
                log.error("Loading the databases failed", { url }, error instanceof Error ? error : undefined);
                setLoaded((previous) => ({ url, data: previous?.url === url ? previous.data : null, error: error instanceof Error ? error.message : fallback }));
            })
            .finally(() => {
                if (!ignore) setReloading(false);
            });
        return () => {
            ignore = true;
        };
    }, [url, version, fallback]);

    const reload = useCallback(() => {
        setReloading(true);
        setVersion((value) => value + 1);
    }, []);

    const current = loaded?.url === url ? loaded : null;
    return { data: current?.data ?? null, error: current?.error ?? null, loading: url !== null && current === null, reloading, reload };
}

/** The runs of a span as the timeline and the panel of a day need them, with the databases of each run looked up. */
export function useDatabaseRuns(url: string | null) {
    const loaded = useDatabaseData<DatabaseRunsData>(url, "The runs could not be loaded.");
    const data = useMemo(() => (loaded.data ? expandRuns(loaded.data) : null), [loaded.data]);
    return { ...loaded, data };
}

/** Reads the databases of these servers, or of all of them, from the servers now, and answers with the fresh overview. */
export async function readNow(serverIds?: string[]): Promise<DatabaseOverview> {
    const res = await fetch("/api/databases/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverIds ? { serverIds } : {}),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.success) throw new Error(payload?.error ?? "The servers could not be read.");
    return payload.data as DatabaseOverview;
}

/** The address of the backups of these jobs on the Backups page. */
export function backupsHref(jobIds: string[]): string {
    const params = new URLSearchParams();
    for (const id of jobIds) params.append("job", id);
    return `/dashboard/backups?${params.toString()}`;
}
