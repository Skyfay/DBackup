"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { TemplatesModel } from "@/services/templates/templates-types";

const log = logger.child({ hook: "use-templates-model" });

async function fetchModel(): Promise<TemplatesModel | null> {
    try {
        const response = await fetch("/api/templates");
        const body = await response.json().catch(() => null);
        if (response.ok && body?.success) return body.data as TemplatesModel;
        toast.error(body?.error || "The templates could not be loaded.");
    } catch (error) {
        log.error("Loading the templates failed", {}, wrapError(error));
        toast.error("The templates could not be loaded.");
    }
    return null;
}

/**
 * Loads every template with what uses it, once for all five tabs, and again after a change.
 * Templates change only when someone changes them, so nothing polls. A refresh keeps the rows on
 * screen while it loads.
 */
export function useTemplatesModel() {
    const [model, setModel] = useState<TemplatesModel | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let ignore = false;
        void fetchModel().then((next) => {
            if (ignore) return;
            if (next) setModel(next);
            setIsLoading(false);
        });
        return () => {
            ignore = true;
        };
    }, []);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        const next = await fetchModel();
        if (next) setModel(next);
        setIsLoading(false);
    }, []);

    return { model, isLoading, refresh };
}
