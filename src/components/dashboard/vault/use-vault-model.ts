"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ hook: "use-vault-model" });

async function fetchModel<T>(url: string): Promise<T | null> {
    try {
        const response = await fetch(url);
        const body = await response.json().catch(() => null);
        if (response.ok && body?.success) return body.data as T;
        toast.error(body?.error || "The Vault could not be loaded.");
    } catch (error) {
        log.error("Loading the Vault failed", { url }, wrapError(error));
        toast.error("The Vault could not be loaded.");
    }
    return null;
}

/**
 * Loads one tab of the Vault page and loads it again after a change. The Vault changes only when
 * someone changes it, so nothing polls. A refresh keeps the rows on screen while it loads.
 */
export function useVaultModel<T>(url: string) {
    const [model, setModel] = useState<T | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let ignore = false;
        void fetchModel<T>(url).then((next) => {
            if (ignore) return;
            if (next) setModel(next);
            setIsLoading(false);
        });
        return () => {
            ignore = true;
        };
    }, [url]);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        const next = await fetchModel<T>(url);
        if (next) setModel(next);
        setIsLoading(false);
    }, [url]);

    return { model, isLoading, refresh };
}
