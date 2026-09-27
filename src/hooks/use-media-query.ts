import { useSyncExternalStore } from "react";

/**
 * Whether the window matches a media query, like `(min-width: 1280px)`, following it as the
 * window changes. The server and the first render in the browser take it as not matching.
 */
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (notify) => {
            const list = window.matchMedia(query);
            list.addEventListener("change", notify);
            return () => list.removeEventListener("change", notify);
        },
        () => window.matchMedia(query).matches,
        () => false,
    );
}
