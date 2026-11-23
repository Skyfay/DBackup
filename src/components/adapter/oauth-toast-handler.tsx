"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { OAUTH_RESULT_PARAMS, oauthResultToast } from "@/lib/core/oauth-result";

/**
 * Shows how an OAuth callback went (`?oauth=success|error&code=...&provider=...`) as a toast and
 * takes it off the address. The sentence comes from the fixed code, never from the address, so a
 * link of another site cannot make the page say what it wants. An unknown code shows nothing.
 *
 * When loaded inside a popup window (window.opener is set), it sends the same fixed sentence to
 * the opener and closes the popup instead of showing a toast.
 */
export function OAuthToastHandler() {
    const searchParams = useSearchParams();
    const router = useRouter();

    useEffect(() => {
        if (!searchParams.get("oauth")) return;
        const result = oauthResultToast(searchParams);

        // When running in a popup, communicate back to the parent and close.
        if (window.opener) {
            if (result) {
                window.opener.postMessage({ type: "oauth_complete", status: result.kind, message: result.text }, window.location.origin);
            }
            window.close();
            return;
        }

        if (result?.kind === "success") toast.success(result.text);
        else if (result) toast.error(result.text);

        // Clean up URL
        const url = new URL(window.location.href);
        for (const name of OAUTH_RESULT_PARAMS) url.searchParams.delete(name);
        router.replace(`${url.pathname}${url.search}`, { scroll: false });
    }, [searchParams, router]);

    return null;
}
