"use client"

import { usePathname } from "next/navigation"
import { ChevronRight, Globe } from "lucide-react"
import Link from "next/link"
import React from "react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { breadcrumbs } from "./breadcrumbs"
import { GlobalSearch } from "./global-search"
import { HeaderLinks } from "./header-links"

interface HeaderProps {
    updateAvailable?: boolean;
    currentVersion?: string;
    latestVersion?: string;
    /** Whether the browser runs on a Mac, iPhone or iPad, for the keys of the search. */
    apple?: boolean;
    userId?: string;
    /** The tenant the breadcrumb starts with in place of Dashboard, see `breadcrumbTenant`. None in All tenants. */
    tenantName?: string | null;
}

/** The bar on top of every page: the sidebar toggle and where you are, the search in the middle, the guides, GitHub and the update on the right. */
export function Header({ updateAvailable, currentVersion, latestVersion, apple, userId, tenantName }: HeaderProps) {
    const pathname = usePathname()
    // The field in the middle and, below lg, the button in the group on the right open the same search.
    const [searchOpen, setSearchOpen] = React.useState(false)
    const crumbs = breadcrumbs(pathname, tenantName)

    return (
        // Three columns, the outer ones as wide as each other, so the search sits in the middle of the page.
        <header className="grid h-15 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b bg-sidebar px-4">
            <div className="flex min-w-0 items-center gap-3">
                <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
                <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
                <nav aria-label="Breadcrumb" className="flex min-w-0 items-center text-[13px] text-muted-foreground">
                    {crumbs.map((crumb, index) => {
                        const isLast = index === crumbs.length - 1
                        const name = crumb.platform ? (
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                                <Globe className="size-3.5 shrink-0" aria-hidden="true" />
                                <span className="truncate">{crumb.name}</span>
                            </span>
                        ) : crumb.name
                        return (
                            <React.Fragment key={`${index}-${crumb.href ?? crumb.name}`}>
                                {index > 0 && <ChevronRight className="h-4 w-4 mx-2 shrink-0 text-muted-foreground/50" />}
                                {isLast ? (
                                    <span className="truncate font-medium text-foreground">{name}</span>
                                ) : crumb.href ? (
                                    <Link href={crumb.href} className="min-w-0 truncate transition-colors hover:text-foreground">
                                        {name}
                                    </Link>
                                ) : (
                                    <span className="min-w-0 truncate">{name}</span>
                                )}
                            </React.Fragment>
                        )
                    })}
                </nav>
            </div>
            <div className="flex justify-center lg:w-[min(32rem,36vw)]">
                <GlobalSearch apple={apple} userId={userId} open={searchOpen} onOpenChange={setSearchOpen} />
            </div>
            <div className="flex justify-end">
                <HeaderLinks updateAvailable={updateAvailable} currentVersion={currentVersion} latestVersion={latestVersion} onSearch={() => setSearchOpen(true)} />
            </div>
        </header>
    )
}
