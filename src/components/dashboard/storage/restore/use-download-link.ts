"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

/** A link works for five minutes. The page counts ten seconds less, so it never runs out while it is copied. */
const LIFETIME_MS = 5 * 60 * 1000 - 10_000;

/** A new one-time link for the backup, or null after telling why there is none. */
async function requestLink(destinationId: string, file: string): Promise<string | null> {
    try {
        const res = await fetch(`/api/storage/${destinationId}/download-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof data.url === "string") return data.url;
        toast.error(typeof data.error === "string" ? data.error : "The download link could not be made");
    } catch {
        toast.error("The download link could not be made");
    }
    return null;
}

/**
 * A one-time download link for a backup, which a script on another host fetches with curl. It
 * counts down the minutes the link works, so the page can say when it ran out.
 */
export function useDownloadLink(destinationId: string, file: string) {
    const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
    const [creating, setCreating] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!link) return;
        const timer = setInterval(() => {
            const at = Date.now();
            setNow(at);
            if (at >= link.expiresAt) clearInterval(timer);
        }, 1000);
        return () => clearInterval(timer);
    }, [link]);

    const create = async () => {
        setCreating(true);
        const url = await requestLink(destinationId, file);
        if (url) {
            const at = Date.now();
            setNow(at);
            setLink({ url, expiresAt: at + LIFETIME_MS });
        }
        setCreating(false);
    };

    /** Downloads the dump in this browser with a link of its own, so the one in the script stays unused. */
    const downloadHere = async () => {
        const url = await requestLink(destinationId, file);
        if (!url) return;
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.click();
    };

    const secondsLeft = link ? Math.max(0, Math.ceil((link.expiresAt - now) / 1000)) : 0;
    return { url: link?.url ?? null, expired: link !== null && secondsLeft === 0, secondsLeft, creating, create, downloadHere };
}

export type DownloadLink = ReturnType<typeof useDownloadLink>;
