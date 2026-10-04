"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ hook: "use-page-model" });

async function fetchModel<T>(url: string, failure: string): Promise<T | null> {
    try {
        const response = await fetch(url);
        const body = await response.json().catch(() => null);
        if (response.ok && body?.success) return body.data as T;
        toast.error(body?.error || failure);
    } catch (error) {
        log.error("Loading a page model failed", { url }, wrapError(error));
        toast.error(failure);
    }
    return null;
}

/**
 * Loads the model of a page or a tab from its route, like `/api/vault/keys`, and loads it again
 * after a change. These pages change only when someone changes them, so nothing polls. A refresh
 * keeps the rows on screen while it loads. Without a url nothing loads, for details that wait for
 * a pick. `failure` is the toast when the route does not answer with a message of its own.
 */
export function usePageModel<T>(url: string | null, failure: string) {
    const [model, setModel] = useState<T | null>(null);
    const [isLoading, setIsLoading] = useState(url !== null);

    useEffect(() => {
        if (!url) return;
        let ignore = false;
        setIsLoading(true);
        void fetchModel<T>(url, failure).then((next) => {
            if (ignore) return;
            if (next) setModel(next);
            setIsLoading(false);
        });
        return () => {
            ignore = true;
        };
    }, [url, failure]);

    const refresh = useCallback(async () => {
        if (!url) return;
        setIsLoading(true);
        const next = await fetchModel<T>(url, failure);
        if (next) setModel(next);
        setIsLoading(false);
    }, [url, failure]);

    return { model, isLoading, refresh };
}
