"use client"

import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"
import Link from "next/link"
import React from "react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function Header() {
    const pathname = usePathname()
    // Split path, filtering empty strings
    const segments = pathname.split('/').filter(Boolean)

    const segmentMap: Record<string, string> = {
        "users": "Users & Groups"
    }

    return (
        <header className="flex h-15 shrink-0 items-center gap-3 border-b bg-sidebar px-4">
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
        </header>
    )
}
