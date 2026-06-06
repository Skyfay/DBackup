"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Handles OAuth redirect query parameters (?oauth=success|error&message=...)
 * and displays a toast notification. Cleans up the URL after processing.
 *
 * When loaded inside a popup window (window.opener is set), it sends a
 * postMessage to the opener and closes the popup instead of showing a toast.
 */
export function OAuthToastHandler() {
    const searchParams = useSearchParams();
    const router = useRouter();

    useEffect(() => {
        const oauthStatus = searchParams.get("oauth");
        const message = searchParams.get("message");

        if (oauthStatus && message) {
            // When running in a popup, communicate back to the parent and close.
            if (window.opener) {
                window.opener.postMessage(
                    { type: "oauth_complete", status: oauthStatus, message },
                    window.location.origin
                );
                window.close();
                return;
            }

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
