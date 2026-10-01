"use client";

import { useCallback, useEffect, useState } from "react";
import { Command as CommandKey } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchItem } from "./search-items";

/** A key of the keyboard, like esc or Cmd K. An icon inside takes a `label` for screen readers. */
export function Kbd({ children, label, className }: { children: React.ReactNode; label?: string; className?: string }) {
    return (
        <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-[5px] border bg-muted px-1.5 font-sans text-[11px] font-medium leading-none text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0", className)}>
            {children}
            {label && <span className="sr-only">{label}</span>}
        </kbd>
    );
}

/** The keys that open the search: ⌘K on a Mac, iPhone or iPad, Ctrl K everywhere else. */
export function SearchShortcut({ apple, className }: { apple: boolean; className?: string }) {
    return (
        <Kbd className={cn("h-6 gap-1 rounded-md px-1.5 text-xs", className)}>
            {apple ? (
                <>
                    <CommandKey aria-hidden="true" />
                    <span className="sr-only">Command</span>
                </>
            ) : (
                <span>Ctrl</span>
            )}
            <span>K</span>
        </Kbd>
    );
}

const RECENT_KEY = "dbackup.search.recent";
const RECENT_MAX = 5;

/**
 * What was opened from the search last, newest first, in this browser and for this person only, so
 * someone else signing in here never sees it.
 */
export function useRecentSearches(userId?: string) {
    const key = userId ? `${RECENT_KEY}:${userId}` : RECENT_KEY;
    const [recent, setRecent] = useState<SearchItem[]>([]);

    useEffect(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(key) ?? "[]");
            if (Array.isArray(stored)) setRecent(stored.slice(0, RECENT_MAX));
        } catch {
            // A private window or cleared storage starts without recent entries.
        }
    }, [key]);

    // Written at once, since choosing an entry closes the search in the same moment. The state of
    // an entry is left out, a job that failed then may be fine by the next search.
    const remember = useCallback((item: SearchItem) => {
        const next = [{ ...item, state: null, key: `recent:${item.href}`, group: "recent" as const }, ...recent.filter((entry) => entry.href !== item.href)].slice(0, RECENT_MAX);
        setRecent(next);
        try {
            localStorage.setItem(key, JSON.stringify(next));
        } catch {
            // Without storage the next search starts without it.
        }
    }, [recent, key]);

    return { recent, remember };
}
