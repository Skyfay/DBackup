"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Handles OAuth redirect query parameters (?oauth=success|error&message=...)
 * and displays a toast notification. Cleans up the URL after processing.
 */
export function OAuthToastHandler() {
    const searchParams = useSearchParams();
    const router = useRouter();

    useEffect(() => {
        const oauthStatus = searchParams.get("oauth");
        const message = searchParams.get("message");

        if (oauthStatus && message) {
            if (oauthStatus === "success") {
                toast.success(message);
            } else if (oauthStatus === "error") {
                toast.error(message);
            }

            // Clean up URL
            const url = new URL(window.location.href);
            url.searchParams.delete("oauth");
            url.searchParams.delete("message");
            router.replace(url.pathname, { scroll: false });
        }
    }, [searchParams, router]);

    return null;
}
