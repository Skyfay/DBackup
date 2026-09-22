"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { saveTableLayout } from "@/app/actions/auth/table-preferences";
import { logger } from "@/lib/logging/logger";
import type { TablePreferences } from "@/lib/core/table-preferences";

const log = logger.child({ hook: "use-table-layout" });
const SAVE_DELAY_MS = 600;

/**
 * Saves a table's column layout to the user's account shortly after the last change, so
 * dragging a column past several others sends one request. Pass the result to DataTable's
 * `columnLayout`.
 */
export function useTableLayout(tableId: string, initial: TablePreferences | null) {
    const pending = useRef<{ value: TablePreferences | null } | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flush = useCallback(async () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        const next = pending.current;
        pending.current = null;
        if (!next) return;

        const result = await saveTableLayout(tableId, next.value);
        if (!result.success) {
            log.warn("Saving a table layout failed", { tableId, error: result.error });
            toast.error("Your column layout could not be saved.");
        }
    }, [tableId]);

    const onChange = useCallback((value: TablePreferences | null) => {
        pending.current = { value };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DELAY_MS);
    }, [flush]);

    // A change made right before leaving the page is still saved.
    useEffect(() => () => void flush(), [flush]);

    return { initial, onChange };
}
