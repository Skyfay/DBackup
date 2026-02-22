"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LayoutDashboard, Database, HardDrive, FolderOpen, CalendarClock, History, Settings, Bell, ChevronsUpDown, LogOut, Moon, Sun, Monitor, Users, User, Lock, BookOpen, SearchCode, Rocket } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useSession, signOut } from "@/lib/auth-client"
import Image from "next/image"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuPortal,
} from "@/components/ui/dropdown-menu"
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useTheme } from "next-themes"
import { PERMISSIONS } from "@/lib/permissions"

interface SidebarItem {
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    label: string;
    href: string;
    permission?: string | string[];
    quickSetupOnly?: boolean;
}

interface SidebarGroup {
    label: string;
    items: SidebarItem[];
}

const sidebarGroups: SidebarGroup[] = [
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
            { icon: Database, label: "Sources", href: "/dashboard/sources", permission: PERMISSIONS.SOURCES.READ },
            { icon: HardDrive, label: "Destinations", href: "/dashboard/destinations", permission: PERMISSIONS.DESTINATIONS.READ },
            { icon: Bell, label: "Notifications", href: "/dashboard/notifications", permission: PERMISSIONS.NOTIFICATIONS.READ },
            { icon: CalendarClock, label: "Jobs", href: "/dashboard/jobs", permission: PERMISSIONS.JOBS.READ },
        ],
    },
    {
        label: "Explorer",
        items: [
            { icon: FolderOpen, label: "Storage Explorer", href: "/dashboard/storage", permission: PERMISSIONS.STORAGE.READ },
            { icon: SearchCode, label: "Database Explorer", href: "/dashboard/explorer", permission: PERMISSIONS.SOURCES.READ },
            { icon: History, label: "History", href: "/dashboard/history", permission: PERMISSIONS.HISTORY.READ },
        ],
    },
    {
        label: "Administration",
        items: [
            { icon: Lock, label: "Vault", href: "/dashboard/vault", permission: PERMISSIONS.VAULT.READ },
            { icon: Users, label: "Users & Groups", href: "/dashboard/users", permission: [PERMISSIONS.USERS.READ, PERMISSIONS.GROUPS.READ, PERMISSIONS.AUDIT.READ, PERMISSIONS.API_KEYS.READ] },
            { icon: Settings, label: "Settings", href: "/dashboard/settings", permission: PERMISSIONS.SETTINGS.READ },
        ],
    },
]

interface SidebarProps {
    permissions?: string[];
    isSuperAdmin?: boolean;
    updateAvailable?: boolean;
    currentVersion?: string;
    latestVersion?: string;
    showQuickSetup?: boolean;
}

export function Sidebar({ permissions = [], isSuperAdmin = false, updateAvailable = false, currentVersion, latestVersion, showQuickSetup = false }: SidebarProps) {
    const pathname = usePathname()
    const { data: session, isPending } = useSession()
    const router = useRouter()
    const { setTheme } = useTheme()

    const handleSignOut = async () => {
        await signOut({
            fetchOptions: {
                onSuccess: () => {
                    router.push("/")
                }
            }
        })
    }

    // Get initials from name or email
    const getInitials = (name?: string) => {
        if (!name) return "U";
        return name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .substring(0, 2);
    };

    return (
        <div className="w-64 border-r bg-background h-screen flex flex-col hidden md:flex sticky top-0 overflow-hidden">
            <div className="h-16 flex items-center px-6 border-b gap-3">
                <Image
                    src="/logo.svg"
                    alt="DBackup Logo"
                    width={28}
                    height={28}
                    priority
                />
                <h1 className="text-xl font-bold tracking-tight">DBackup</h1>
            </div>
            <ScrollArea className="flex-1 overflow-hidden">
                <nav className="p-4 space-y-6">
                {sidebarGroups.map((group) => {
                    // Filter visible items for this group
                    const visibleItems = group.items.filter((item) => {
                        if ('quickSetupOnly' in item && item.quickSetupOnly && !showQuickSetup) return false;
                        if (item.permission) {
                            const requiredPerms = Array.isArray(item.permission) ? item.permission : [item.permission];
                            const hasAny = requiredPerms.some((p) => permissions.includes(p));
                            if (!isSuperAdmin && !hasAny) return false;
                        }
                        return true;
                    });

                    // Don't render group if no items are visible
                    if (visibleItems.length === 0) return null;

                    return (
                        <div key={group.label} className="space-y-1">
                            <h4 className="px-2 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                                {group.label}
                            </h4>
                            {visibleItems.map((item) => (
                                <Button
                                    key={item.href}
                                    variant={pathname === item.href ? "secondary" : "ghost"}
                                    className={cn("w-full justify-start", pathname === item.href && "font-semibold")}
                                    asChild
                                >
                                    <Link href={item.href}>
                                        <item.icon className="mr-2 h-4 w-4" />
                                        {item.label}
                                    </Link>
                                </Button>
                            ))}
                        </div>
                    );
                })}
                </nav>
            </ScrollArea>
            {currentVersion && (
                <div className="px-6 pb-2 text-xs text-muted-foreground/50 select-none flex items-center justify-center gap-2">
                    <span>v{currentVersion}</span>
                    {updateAvailable && (
                         <button
                            onClick={() => window.open('https://gitlab.com/Skyfay/dbackup/-/releases', '_blank')}
                            className="text-orange-500 font-medium flex items-center gap-1 animate-pulse hover:text-orange-400 cursor-pointer bg-transparent border-0 p-0"
                        >
                            <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                            Update available
                         </button>
                    )}
                </div>
            )}
            <div className="p-4 border-t">
                {isPending ? (
                     <div className="flex items-center gap-3 rounded-lg border p-3 shadow-sm bg-muted/50">
                        <Skeleton className="h-9 w-9 rounded-full" />
                        <div className="flex flex-col gap-1">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-3 w-32" />
                        </div>
                    </div>
                ) : session ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="relative h-auto w-full justify-start gap-2 px-2 hover:bg-sidebar-accent">
                                <div className="relative">
                                    <Avatar className="h-8 w-8 rounded-lg">
                                        <AvatarImage src={session.user.image || ""} alt={session.user.name} />
                                        <AvatarFallback className="rounded-lg">{getInitials(session.user.name)}</AvatarFallback>
                                    </Avatar>
                                    {updateAvailable && isSuperAdmin && (
                                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500"></span>
                                        </span>
                                    )}
                                </div>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-semibold">{session.user.name}</span>
                                    <span className="truncate text-xs text-muted-foreground">{session.user.email}</span>
                                </div>
                                <ChevronsUpDown className="ml-auto size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                            side="top" // Open upwards as it is at the bottom
                            align="end"
                            sideOffset={4}
                        >
                            <DropdownMenuLabel className="p-0 font-normal">
                                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                    <div className="relative">
                                        <Avatar className="h-8 w-8 rounded-lg">
                                            <AvatarImage src={session.user.image || ""} alt={session.user.name} />
                                            <AvatarFallback className="rounded-lg">{getInitials(session.user.name)}</AvatarFallback>
                                        </Avatar>
                                        {updateAvailable && isSuperAdmin && (
                                            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-orange-500 border-2 border-background" />
                                        )}
                                    </div>
                                    <div className="grid flex-1 text-left text-sm leading-tight">
                                        <span className="truncate font-semibold">{session.user.name}</span>
                                        <span className="truncate text-xs text-muted-foreground">{session.user.email}</span>
                                    </div>
                                </div>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                             <DropdownMenuGroup>
                                {updateAvailable && isSuperAdmin && (
                                    <DropdownMenuItem className="text-orange-600 focus:text-orange-600 font-medium" onClick={() => window.open('https://gitlab.com/Skyfay/dbackup/-/releases', '_blank')}>
                                        <div className="flex items-center w-full">
                                            <Bell className="mr-2 h-4 w-4 text-orange-500" />
                                            <span>Update available {latestVersion ? `(${latestVersion})` : ''}</span>
                                        </div>
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => router.push('/dashboard/profile')}>
                                    <User className="mr-2 h-4 w-4" />
                                    <span>Profile</span>
                                </DropdownMenuItem>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <Monitor className="mr-2 h-4 w-4" />
                                        <span>Theme</span>
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuPortal>
                                        <DropdownMenuSubContent>
                                            <DropdownMenuItem onClick={() => setTheme("light")}>
                                                <Sun className="mr-2 h-4 w-4" />
                                                <span>Light</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setTheme("dark")}>
                                                <Moon className="mr-2 h-4 w-4" />
                                                <span>Dark</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setTheme("system")}>
                                                <Monitor className="mr-2 h-4 w-4" />
                                                <span>System</span>
                                            </DropdownMenuItem>
                                        </DropdownMenuSubContent>
                                    </DropdownMenuPortal>
                                </DropdownMenuSub>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => window.open('https://dbackup.app', '_blank')}>
                                <BookOpen className="mr-2 h-4 w-4" />
                                Documentation
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={handleSignOut}>
                                <LogOut className="mr-2 h-4 w-4" />
                                Log out
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </div>
        </div>
    )
}
