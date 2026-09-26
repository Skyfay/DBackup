"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** A link works for five minutes. The page counts ten seconds less, so it never runs out while it is copied. */
const LIFETIME_MS = 5 * 60 * 1000 - 10_000;

/** How often an open link asks whether it was fetched yet. */
const POLL_MS = 3000;

interface Link {
    url: string;
    token: string | null;
    fileName: string | null;
    expiresAt: number;
}

interface LinkResponse {
    success?: boolean;
    data?: { url?: string; token?: string; fileName?: string };
    url?: string;
    error?: string;
}

/**
 * Hands a response to the key prompt of the page, which answers it and runs the request again,
 * with the fields that name the key it settled on.
 */
export type InterceptKey = (response: Response, retry: (extra?: Record<string, unknown>) => void) => Promise<boolean>;

/**
 * A one-time download link for a backup or part of it, which a command on another host fetches.
 * It counts down the minutes the link works and asks the server whether it was fetched, so the
 * page can say when it ran out or was used up.
 */
export function useDownloadLink(destinationId: string, file: string, options: { intercept?: InterceptKey } = {}) {
    const [link, setLink] = useState<Link | null>(null);
    const [creating, setCreating] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const [fetched, setFetched] = useState<{ at: number; from: string | null } | null>(null);
    const intercept = useRef(options.intercept);
    useEffect(() => {
        intercept.current = options.intercept;
    }, [options.intercept]);

    async function request(body: Record<string, unknown>, retry: (extra?: Record<string, unknown>) => void): Promise<Link | null> {
        try {
            const res = await fetch(`/api/storage/${destinationId}/download-url`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file, ...body }),
            });
            if (intercept.current && (await intercept.current(res, retry))) return null;
            const data: LinkResponse = await res.json().catch(() => ({}));
            const url = data.data?.url ?? data.url;
            if (res.ok && typeof url === "string") {
                return { url, token: data.data?.token ?? null, fileName: data.data?.fileName ?? null, expiresAt: Date.now() + LIFETIME_MS };
            }
            toast.error(typeof data.error === "string" ? data.error : "The download link could not be made");
        } catch {
            toast.error("The download link could not be made");
        }
        return null;
    }

    /** Makes a new link, for the whole file or for the pick in `body`. */
    async function create(body: Record<string, unknown> = {}) {
        setCreating(true);
        const made = await request(body, (extra) => void create({ ...body, ...extra }));
        if (made) {
            setNow(Date.now());
            setFetched(null);
            setLink(made);
        }
        setCreating(false);
    }

    /** Forgets the link, when what it would fetch changed. */
    const reset = useCallback(() => {
        setLink(null);
        setFetched(null);
    }, []);

    /** Downloads in this browser with a link of its own, so the one in the command stays unused. */
    async function downloadHere(body: Record<string, unknown> = {}) {
        const made = await request(body, (extra) => void downloadHere({ ...body, ...extra }));
        if (!made) return;
        const anchor = document.createElement("a");
        anchor.href = made.url;
        anchor.click();
    }

    // The countdown, which stops once the link ran out or was fetched.
    useEffect(() => {
        if (!link || fetched) return;
        const timer = setInterval(() => {
            const at = Date.now();
            setNow(at);
            if (at >= link.expiresAt) clearInterval(timer);
        }, 1000);
        return () => clearInterval(timer);
    }, [link, fetched]);

    // Asks whether the link was fetched, while it is open and the tab is in view.
    useEffect(() => {
        if (!link?.token || fetched) return;
        const token = link.token;
        const timer = setInterval(async () => {
            if (document.hidden || Date.now() >= link.expiresAt) return;
            try {
                const res = await fetch(`/api/storage/${destinationId}/download-url?token=${encodeURIComponent(token)}`);
                const data: { data?: { state?: string; fetchedAt?: number; fetchedFrom?: string } } = await res.json().catch(() => ({}));
                if (data.data?.state === "fetched") setFetched({ at: data.data.fetchedAt ?? Date.now(), from: data.data.fetchedFrom ?? null });
            } catch {
                // The next round asks again.
            }
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [destinationId, link, fetched]);

    const secondsLeft = link ? Math.max(0, Math.ceil((link.expiresAt - now) / 1000)) : 0;
    return {
        url: link?.url ?? null,
        fileName: link?.fileName ?? null,
        expired: link !== null && !fetched && secondsLeft === 0,
        fetched,
        secondsLeft,
        creating,
        create,
        reset,
        downloadHere,
    };
}

export type DownloadLink = ReturnType<typeof useDownloadLink>;
