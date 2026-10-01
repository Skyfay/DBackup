"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Opens the record a link names, like `?open=` from the search in the header, once its list has
 * loaded, then takes the name off the address. So a link to the page that is already open opens its
 * record too, and the same link opens it again after its panel was closed. A record the list does
 * not hold, like one deleted since, is skipped.
 *
 * The rows are null or undefined until they loaded, never an empty list in their place, or a link
 * that arrives before them is dropped.
 */
export function useOpenFromLink<Row extends { id: string }>(rows: readonly Row[] | null | undefined, open: (row: Row) => void, param = "open") {
    const wanted = useSearchParams().get(param);
    const openRef = useRef(open);
    const handled = useRef<string | null>(null);

    useEffect(() => {
        openRef.current = open;
    });

    useEffect(() => {
        if (!wanted) {
            handled.current = null;
            return;
        }
        if (!rows || handled.current === wanted) return;
        handled.current = wanted;
        const row = rows.find((entry) => entry.id === wanted);
        if (row) openRef.current(row);
        // The history of the browser, so the page stays as it is. Next.js follows it in useSearchParams.
        const rest = new URLSearchParams(window.location.search);
        rest.delete(param);
        const query = rest.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }, [wanted, rows, param]);
}
