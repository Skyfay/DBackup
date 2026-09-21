"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
    ArrowUpCircle,
    CalendarClock,
    Database,
    FolderOpen,
    History,
    LayoutDashboard,
    LayoutTemplate,
    Lock,
    Rocket,
    SearchCode,
    Settings,
    Users,
    type LucideIcon,
} from "lucide-react"
import { PERMISSIONS } from "@/lib/auth/permissions"
import { NavUser } from "@/components/layout/nav-user"
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

interface NavItem {
    icon: LucideIcon;
    label: string;
    href: string;
    permission?: string | string[];
    quickSetupOnly?: boolean;
}

interface NavGroup {
    label: string;
    items: NavItem[];
}

const navGroups: NavGroup[] = [
    {
        label: "General",
        items: [
            { icon: LayoutDashboard, label: "Overview", href: "/dashboard" },
            { icon: Rocket, label: "Quick Setup", href: "/dashboard/setup", permission: [PERMISSIONS.SOURCES.WRITE, PERMISSIONS.DESTINATIONS.WRITE, PERMISSIONS.JOBS.WRITE], quickSetupOnly: true },
        ],
    },
    {
        label: "Backup",
        items: [
            // Databases, storage in either role, and notification channels all live under
            // one entry - they are the same kind of thing (something DBackup connects to)
            // and only differ in what they connect to.
            { icon: Database, label: "Connections", href: "/dashboard/connections", permission: [PERMISSIONS.SOURCES.VIEW, PERMISSIONS.DESTINATIONS.READ, PERMISSIONS.NOTIFICATIONS.READ] },
            { icon: CalendarClock, label: "Jobs", href: "/dashboard/jobs", permission: PERMISSIONS.JOBS.READ },
        ],
    },
    {
        label: "Explorer",
        items: [
            { icon: FolderOpen, label: "Storage Explorer", href: "/dashboard/storage", permission: PERMISSIONS.STORAGE.READ },
            { icon: SearchCode, label: "Database Explorer", href: "/dashboard/explorer", permission: PERMISSIONS.SOURCES.VIEW },
            { icon: History, label: "History", href: "/dashboard/history", permission: PERMISSIONS.HISTORY.READ },
        ],
    },
    {
        label: "Administration",
        items: [
            { icon: Lock, label: "Vault", href: "/dashboard/vault", permission: PERMISSIONS.VAULT.READ },
            { icon: LayoutTemplate, label: "Templates", href: "/dashboard/templates", permission: PERMISSIONS.TEMPLATES.READ },
            { icon: Users, label: "Users & Groups", href: "/dashboard/users", permission: [PERMISSIONS.USERS.READ, PERMISSIONS.GROUPS.READ, PERMISSIONS.AUDIT.READ, PERMISSIONS.API_KEYS.READ] },
            { icon: Settings, label: "Settings", href: "/dashboard/settings", permission: PERMISSIONS.SETTINGS.READ },
        ],
    },
]

const RELEASES_URL = "https://github.com/Skyfay/DBackup/releases"

interface AppSidebarProps {
    permissions?: string[];
    isSuperAdmin?: boolean;
    updateAvailable?: boolean;
    currentVersion?: string;
    latestVersion?: string;
    showQuickSetup?: boolean;
    groupName?: string;
}

/** Overview is the index route and only matches exactly. Every other entry also owns its sub-pages. */
function isActiveRoute(pathname: string, href: string) {
    if (href === "/dashboard") return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ permissions = [], isSuperAdmin = false, updateAvailable = false, currentVersion, latestVersion, showQuickSetup = false, groupName }: AppSidebarProps) {
    const pathname = usePathname()
    const { isMobile, setOpenMobile } = useSidebar()

    // The slide-in sheet on small screens would stay open over the page it just navigated to.
    const closeMobileSheet = () => {
        if (isMobile) setOpenMobile(false)
    }

    const visibleGroups = navGroups
        .map((group) => ({
            ...group,
            items: group.items.filter((item) => {
                if (item.quickSetupOnly && !showQuickSetup) return false;
                if (item.permission) {
                    const requiredPerms = Array.isArray(item.permission) ? item.permission : [item.permission];
                    const hasAny = requiredPerms.some((p) => permissions.includes(p));
                    if (!isSuperAdmin && !hasAny) return false;
                }
                return true;
            }),
        }))
        .filter((group) => group.items.length > 0)

    const updateLabel = latestVersion ? `Update to ${latestVersion}` : "Update available"

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader className="h-15 justify-center border-b border-sidebar-border py-0">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild className="hover:bg-transparent active:bg-transparent">
                            <Link href="/dashboard" onClick={closeMobileSheet}>
                                <Image src="/logo.svg" alt="DBackup Logo" width={32} height={32} priority className="size-8 shrink-0" />
                                <div className="grid flex-1 text-left leading-tight">
                                    <span className="truncate font-semibold text-sidebar-foreground">DBackup</span>
                                    {currentVersion && (
                                        <span className="truncate font-mono text-xs text-sidebar-foreground/55">v{currentVersion}</span>
                                    )}
                                </div>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                {visibleGroups.map((group) => (
                    <SidebarGroup key={group.label}>
                        <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                        <SidebarMenu>
                            {group.items.map((item) => {
                                const isActive = isActiveRoute(pathname, item.href)
                                return (
                                    <SidebarMenuItem key={item.href}>
                                        <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                                            <Link href={item.href} onClick={closeMobileSheet} aria-current={isActive ? "page" : undefined}>
                                                <item.icon />
                                                <span>{item.label}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )
                            })}
                        </SidebarMenu>
                    </SidebarGroup>
                ))}
            </SidebarContent>

            <SidebarFooter className="border-t border-sidebar-border">
                {updateAvailable && (
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton asChild tooltip={updateLabel} className="[&>svg]:text-info hover:[&>svg]:text-info">
                                <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
                                    <ArrowUpCircle />
                                    <span>{updateLabel}</span>
                                </a>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                )}
                <NavUser groupName={groupName} />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
