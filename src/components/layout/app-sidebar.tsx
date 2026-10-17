"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
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
import { isActiveRoute, navSections, type NavItem } from "./nav-sections"

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

export function AppSidebar({ permissions = [], isPlatformAdmin = false, currentVersion, instanceName, showQuickSetup = false, ownDatabases = true, groupName, tenants = [], activeTenantId = null, allTenants = false, tenantCount = 1, tenantAccess }: AppSidebarProps) {
    const pathname = usePathname()
    const { isMobile, setOpenMobile } = useSidebar()

    // The slide-in sheet on small screens would stay open over the page it just navigated to.
    const closeMobileSheet = () => {
        if (isMobile) setOpenMobile(false)
    }

    const held = new Set(permissions)
    const sections = navSections({ tenantCount, isPlatformAdmin, allTenants, showQuickSetup, ownDatabases }, (permission) => held.has(permission))

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

            {/* Platform, which decides over every tenant, is the last section, below Administration. */}
            <SidebarContent>
                {sections.map((group) => (
                    <SidebarGroup key={group.label}>
                        <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                        <NavItems items={group.items} pathname={pathname} onNavigate={closeMobileSheet} />
                    </SidebarGroup>
                ))}
            </SidebarContent>

            <SidebarFooter className="gap-1 border-t border-sidebar-border px-2.5 py-2">
                <NavUser groupName={groupName} version={currentVersion} />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
