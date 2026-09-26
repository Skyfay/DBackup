"use client";

import { useEffect, useState } from "react";
import type { DockerVolumeEntry } from "@/lib/adapters/storage/docker/inventory";

export type DockerVolumeListing = { status: "loading" } | { status: "failed"; message: string } | { status: "loaded"; volumes: DockerVolumeEntry[] };

const FAILED = "The volumes could not be loaded.";

/**
 * The volumes of a Docker connection with the containers that mount them, and how big each one
 * is. The list comes first and works on its own. The sizes take the daemon longer, and a list
 * without them only leaves them out.
 */
export function useDockerVolumes(configId: string) {
    const [listing, setListing] = useState<DockerVolumeListing>({ status: "loading" });
    const [sizes, setSizes] = useState<Record<string, number> | null>(null);
    const [sizesLoading, setSizesLoading] = useState(true);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        const base = `/api/adapters/${encodeURIComponent(configId)}/volumes`;
        fetch(base)
            .then((res) => res.json())
            .then((body) => {
                if (!active) return;
                const volumes = body?.data?.volumes;
                setListing(body?.success && Array.isArray(volumes) ? { status: "loaded", volumes } : { status: "failed", message: body?.error || FAILED });
            })
            .catch(() => active && setListing({ status: "failed", message: FAILED }));

        fetch(`${base}/sizes`)
            .then((res) => res.json())
            .then((body) => {
                if (active && body?.success && body.data?.sizes) setSizes(body.data.sizes);
            })
            .catch(() => {
                // Without sizes the list still works, it only leaves them out.
            })
            .finally(() => active && setSizesLoading(false));

        return () => {
            active = false;
        };
    }, [configId, attempt]);

    const reload = () => {
        setListing({ status: "loading" });
        setSizes(null);
        setSizesLoading(true);
        setAttempt((current) => current + 1);
    };

    return { listing, sizes, sizesLoading, reload };
}
