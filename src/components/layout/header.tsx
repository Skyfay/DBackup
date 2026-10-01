"use client"

import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"
import Link from "next/link"
import React from "react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { GlobalSearch } from "./global-search"
import { HeaderLinks } from "./header-links"

interface HeaderProps {
    updateAvailable?: boolean;
    currentVersion?: string;
    latestVersion?: string;
    /** Whether the browser runs on a Mac, iPhone or iPad, for the keys of the search. */
    apple?: boolean;
    userId?: string;
}

/** The bar on top of every page: the sidebar toggle and where you are, the search in the middle, the guides, GitHub and the update on the right. */
export function Header({ updateAvailable, currentVersion, latestVersion, apple, userId }: HeaderProps) {
    const pathname = usePathname()
    // Split path, filtering empty strings
    const segments = pathname.split('/').filter(Boolean)

    const segmentMap: Record<string, string> = {
        "users": "Users & Groups",
        "setup": "Quick Setup",
        "explorer": "Database Explorer"
    }

    return (
        // Three columns, the outer ones as wide as each other, so the search sits in the middle of the page.
        <header className="grid h-15 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b bg-sidebar px-4">
            <div className="flex min-w-0 items-center gap-3">
                <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
                <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
                <nav aria-label="Breadcrumb" className="flex min-w-0 items-center text-[13px] text-muted-foreground">
                    {segments.map((segment, index) => {
                        const isLast = index === segments.length - 1
                        const href = `/${segments.slice(0, index + 1).join('/')}`

                        // Capitalize first letter or use map
                        const name = segmentMap[segment] || (segment.charAt(0).toUpperCase() + segment.slice(1))

                        return (
                            <React.Fragment key={href}>
                                {index > 0 && <ChevronRight className="h-4 w-4 mx-2 shrink-0 text-muted-foreground/50" />}
                                {isLast ? (
                                    <span className="truncate font-medium text-foreground">{name}</span>
                                ) : (
                                    <Link href={href} className="hover:text-foreground transition-colors">
                                        {name}
                                    </Link>
                                )}
                            </React.Fragment>
                        )
                    })}
                </nav>
            </div>
            <div className="flex justify-center lg:w-[min(32rem,36vw)]">
                <GlobalSearch apple={apple} userId={userId} />
            </div>
            <div className="flex justify-end">
                <HeaderLinks updateAvailable={updateAvailable} currentVersion={currentVersion} latestVersion={latestVersion} />
            </div>
        </header>
    )
}
