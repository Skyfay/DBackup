"use client"

import { usePathname } from "next/navigation"

const routeTitles: Record<string, string> = {
    "/dashboard": "Overview",
    "/dashboard/sources": "Sources",
    "/dashboard/destinations": "Destinations",
    "/dashboard/storage": "Storage Explorer",
    "/dashboard/jobs": "Backup Jobs",
    "/dashboard/history": "Execution History",
    "/dashboard/notifications": "Notifications",
    "/dashboard/settings": "Settings",
}

export function Header() {
    const pathname = usePathname()
    // Find exact match or fallback for sub-routes (simple implementation)
    const title = routeTitles[pathname] ||
                  Object.entries(routeTitles).find(([route]) => pathname.startsWith(route) && route !== '/dashboard')?.[1] ||
                  "Database Backup Manager";

    return (
        <header className="border-b h-16 flex items-center px-6 bg-background sticky top-0 z-10">
            <h2 className="text-lg font-medium">{title}</h2>
            <div className="ml-auto flex items-center gap-4">
                 {/* Placeholder for header actions like Theme Toggle or Search */}
            </div>
        </header>
    )
}
