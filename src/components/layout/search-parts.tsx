"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SearchItem } from "./search-items";

/** A key of the keyboard, like esc or Cmd K. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground", className)}>
            {children}
        </kbd>
    );
}

const RECENT_KEY = "dbackup.search.recent";
const RECENT_MAX = 5;

/** What was opened from the search last, in this browser, newest first. */
export function useRecentSearches() {
    const [recent, setRecent] = useState<SearchItem[]>([]);

    useEffect(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
            if (Array.isArray(stored)) setRecent(stored.slice(0, RECENT_MAX));
        } catch {
            // A private window or cleared storage starts without recent entries.
        }
    }, []);

    // Written at once, since choosing an entry closes the search in the same moment. The state of
    // an entry is left out, a job that failed then may be fine by the next search.
    const remember = useCallback((item: SearchItem) => {
        const next = [{ ...item, state: null, key: `recent:${item.href}`, group: "recent" as const }, ...recent.filter((entry) => entry.href !== item.href)].slice(0, RECENT_MAX);
        setRecent(next);
        try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        } catch {
            // Without storage the next search starts without it.
        }
    }, [recent]);

    return { recent, remember };
}
