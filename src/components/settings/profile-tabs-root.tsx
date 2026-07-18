"use client"

import { useSearchParams } from "next/navigation"
import { Tabs } from "@/components/ui/tabs"

/**
 * Thin client wrapper around the root `Tabs` element so the initial tab can
 * be selected from a `?tab=` query param (e.g. after the SSO "connect" flow
 * redirects back to /dashboard/profile?tab=sso). Everything else on the
 * Profile page stays a Server Component.
 */
export function ProfileTabsRoot({ children }: { children: React.ReactNode }) {
    const searchParams = useSearchParams()
    const initialTab = searchParams.get("tab") || "profile"

    return (
        <Tabs defaultValue={initialTab} className="space-y-4">
            {children}
        </Tabs>
    )
}
