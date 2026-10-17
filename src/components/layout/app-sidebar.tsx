"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Globe } from "lucide-react"
import { NavUser } from "@/components/layout/nav-user"
import { SidebarHead } from "@/components/layout/tenant-switcher"
import type { HeadTenant } from "@/components/layout/tenant-switch"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    useSidebar,
} from "@/components/ui/sidebar"
import { isActiveRoute, navSections, platformLine, type NavItem } from "./nav-sections"

interface AppSidebarProps {
    permissions?: string[];
    isPlatformAdmin?: boolean;
    currentVersion?: string;
    /** The name under General, which the head shows instead of DBackup. */
    instanceName?: string;
    showQuickSetup?: boolean;
    /** Whether the tenant has or may add a database connection, which the Database Explorer needs. */
    ownDatabases?: boolean;
    groupName?: string;
    /** The tenants the viewer may open, the home tenant first, which the head switches between. */
    tenants?: HeadTenant[];
    /** The tenant the viewer works in, null in All tenants. */
    activeTenantId?: string | null;
    /** A platform admin looks at every tenant at once. */
    allTenants?: boolean;
    /** How many tenants the instance has, also the ones the viewer may not open. */
    tenantCount?: number;
    /** What the viewer may do with the tenants in the head, as `isPlatformAdmin` when left out. */
    tenantAccess?: { opensAll: boolean; see: boolean; create: boolean };
    /** The platform group of the viewer, which the section Platform names. */
    platformGroupName?: string | null;
}

/** The entries of one section, each a link that marks the page it leads to. */
function NavItems({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate: () => void }) {
    return (
        <SidebarMenu>
            {items.map((item) => {
                const isActive = isActiveRoute(pathname, item.href)
                return (
                    <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                            <Link href={item.href} onClick={onNavigate} aria-current={isActive ? "page" : undefined}>
                                <item.icon />
                                <span>{item.label}</span>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                )
            })}
        </SidebarMenu>
    )
}

export function AppSidebar({ permissions = [], isPlatformAdmin = false, currentVersion, instanceName, showQuickSetup = false, ownDatabases = true, groupName, tenants = [], activeTenantId = null, allTenants = false, tenantCount = 1, tenantAccess, platformGroupName = null }: AppSidebarProps) {
    const pathname = usePathname()
    const { isMobile, setOpenMobile } = useSidebar()

    // The slide-in sheet on small screens would stay open over the page it just navigated to.
    const closeMobileSheet = () => {
        if (isMobile) setOpenMobile(false)
    }

    const held = new Set(permissions)
    const sections = navSections({ tenantCount, isPlatformAdmin, allTenants, showQuickSetup, ownDatabases }, (permission) => held.has(permission))
    const platform = sections.find((group) => group.platform)

    return (
        <Sidebar collapsible="icon">
            {/* Where the viewer works, and the menu of the tenants for whoever may switch or manage them. */}
            <SidebarHeader className="h-15 justify-center border-b border-sidebar-border px-2.5 py-0">
                <SidebarHead
                    tenants={tenants}
                    activeTenantId={activeTenantId}
                    allTenants={allTenants}
                    isPlatformAdmin={isPlatformAdmin}
                    opensAllTenants={tenantAccess?.opensAll}
                    canSeeTenants={tenantAccess?.see}
                    canCreateTenants={tenantAccess?.create}
                    tenantCount={tenantCount}
                    instanceName={instanceName}
                    version={currentVersion}
                />
            </SidebarHeader>

            <SidebarContent>
                {sections.filter((group) => !group.platform).map((group) => (
                    <SidebarGroup key={group.label}>
                        <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                        <NavItems items={group.items} pathname={pathname} onNavigate={closeMobileSheet} />
                    </SidebarGroup>
                ))}
            </SidebarContent>

            {/* What decides over every tenant, apart at the foot in every view, so it never reads as part of the tenant open above. */}
            {platform && (
                <SidebarGroup className="shrink-0 pt-1 pb-2">
                    <div
                        role="group"
                        aria-label={`${platform.label}, ${platformLine(tenantCount, isPlatformAdmin ? null : platformGroupName)}`}
                        className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-1 group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 dark:bg-sidebar-accent/30"
                    >
                        <SidebarGroupLabel className="gap-1.5 px-2 text-sidebar-foreground/75 dark:text-sidebar-foreground/70">
                            <Globe aria-hidden="true" />
                            <span className="font-semibold">{platform.label}</span>
                            <span className="ml-auto truncate font-normal text-sidebar-foreground/55">{platformLine(tenantCount, isPlatformAdmin ? null : platformGroupName)}</span>
                        </SidebarGroupLabel>
                        <NavItems items={platform.items} pathname={pathname} onNavigate={closeMobileSheet} />
                    </div>
                </SidebarGroup>
            )}

            <SidebarFooter className="gap-1 border-t border-sidebar-border px-2.5 py-2">
                <NavUser groupName={groupName} version={currentVersion} />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
