"use client";

import { useCallback, useEffect, useState } from "react";
import { logger } from "@/lib/logging/logger";
import type { ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";

const log = logger.child({ component: "storage-explorer" });

async function fetchData<T>(url: string): Promise<T> {
    const res = await fetch(url);
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.success) throw new Error(payload?.error ?? "The backups could not be loaded.");
    return payload.data as T;
}

interface Loaded<T> {
    url: string;
    data: T | null;
    error: string | null;
}

/**
 * Loads one of the explorer's views. A new address starts empty, so the page shows its skeleton,
 * while `reload` keeps what is shown until the fresh answer is in.
 */
export function useExplorerData<T>(url: string | null) {
    const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
    const [version, setVersion] = useState(0);
    const [reloading, setReloading] = useState(false);

    useEffect(() => {
        if (!url) return;
        let ignore = false;
        fetchData<T>(url)
            .then((data) => {
                if (!ignore) setLoaded({ url, data, error: null });
            })
            .catch((error: unknown) => {
                if (ignore) return;
                log.error("Loading the backups failed", { url }, error instanceof Error ? error : undefined);
                setLoaded((previous) => ({ url, data: previous?.url === url ? previous.data : null, error: error instanceof Error ? error.message : "The backups could not be loaded." }));
            })
            .finally(() => {
                if (!ignore) setReloading(false);
            });
        return () => {
            ignore = true;
        };
    }, [url, version]);

    const reload = useCallback(() => {
        setReloading(true);
        setVersion((value) => value + 1);
    }, []);

    const current = loaded?.url === url ? loaded : null;
    return { data: current?.data ?? null, error: current?.error ?? null, loading: url !== null && current === null, reloading, reload };
}

/**
 * Asks DBackup to compare these destinations with the storage. The listings run in the background,
 * the index reports them as `listing` until they are done.
 */
export async function checkNow(destinations: ExplorerDestination[]): Promise<void> {
    const res = await fetch("/api/storage/explorer/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinationIds: destinations.map((destination) => destination.id) }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.success) throw new Error(payload?.error ?? "The destinations could not be checked.");
}

/** The job a key stands for, and where its backups lie. */
export function destinationsOf(job: ExplorerJob | null, destinations: Map<string, ExplorerDestination>): ExplorerDestination[] {
    if (!job) return [];
    return job.destinationIds.map((id) => destinations.get(id)).filter((entry): entry is ExplorerDestination => entry !== undefined);
}
