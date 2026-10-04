"use client";

import { useEffect, useState } from "react";
import { logger } from "@/lib/logging/logger";
import type { StorageSnapshotEntry } from "@/services/dashboard-service";

const log = logger.child({ component: "use-storage-history" });

/** The longest range a history shows and the most the API hands out. It loads once, the shorter ranges are cut from it. */
export const LOADED_DAYS = 365;

export type StorageHistoryResult =
    | { configId: string; loadedAt: number; entries: StorageSnapshotEntry[] }
    | { configId: string; error: string };

/**
 * The measured sizes of a destination, loaded while `enabled`. Null while they load, and a result
 * of another destination counts as loading, so a new destination needs no reset.
 */
export function useStorageHistory(configId: string, enabled = true): StorageHistoryResult | null {
    const [result, setResult] = useState<StorageHistoryResult | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let ignore = false;
        fetch(`/api/storage/${configId}/history?days=${LOADED_DAYS}`)
            .then((res) => res.json())
            .then((json) => {
                if (ignore) return;
                setResult(
                    json.success
                        ? { configId, loadedAt: Date.now(), entries: json.data }
                        : { configId, error: json.error || "Failed to load history" }
                );
            })
            .catch((error: unknown) => {
                if (ignore) return;
                log.error("Loading the storage history failed", { configId }, error instanceof Error ? error : undefined);
                setResult({ configId, error: "Failed to load history" });
            });
        return () => {
            ignore = true;
        };
    }, [configId, enabled]);

    return result?.configId === configId ? result : null;
}
