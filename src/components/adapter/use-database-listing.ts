"use client";

import { useEffect, useState } from "react";

/** How big a database is, as far as the server says. */
export interface DatabaseStats {
    sizeInBytes?: number;
    tableCount?: number;
}

export type DatabaseListing = { status: "loading" } | { status: "failed"; message: string } | { status: "loaded"; names: string[] };

const FAILED = "The databases could not be loaded.";

/**
 * The databases on the server of a source, and how big each one is. The names come first and
 * the list works with them alone. The sizes take the server longer and never come for a kind that
 * cannot tell them.
 */
export function useDatabaseListing(sourceId: string) {
    const [listing, setListing] = useState<DatabaseListing>({ status: "loading" });
    const [stats, setStats] = useState<Map<string, DatabaseStats> | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        fetch(`/api/adapters/${encodeURIComponent(sourceId)}/databases`)
            .then((res) => res.json())
            .then((body) => {
                if (!active) return;
                setListing(body?.success && Array.isArray(body.databases) ? { status: "loaded", names: body.databases } : { status: "failed", message: body?.error || FAILED });
            })
            .catch(() => active && setListing({ status: "failed", message: FAILED }));

        fetch("/api/adapters/database-stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceId }),
        })
            .then((res) => res.json())
            .then((body: { success?: boolean; databases?: ({ name: string } & DatabaseStats)[] }) => {
                if (active && body?.success && Array.isArray(body.databases)) {
                    setStats(new Map(body.databases.map(({ name, sizeInBytes, tableCount }) => [name, { sizeInBytes, tableCount }])));
                }
            })
            .catch(() => {
                // Without sizes the list still works, it only leaves them out.
            })
            .finally(() => active && setStatsLoading(false));

        return () => {
            active = false;
        };
    }, [sourceId, attempt]);

    const reload = () => {
        setListing({ status: "loading" });
        setStats(null);
        setStatsLoading(true);
        setAttempt((current) => current + 1);
    };

    return { listing, stats, statsLoading, reload };
}
