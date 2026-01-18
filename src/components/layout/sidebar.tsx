"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LayoutDashboard, Database, HardDrive, FolderOpen, CalendarClock, History, Settings, Bell, ChevronsUpDown, LogOut, Moon, Sun, Monitor, Users, User, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useSession, signOut } from "@/lib/auth-client"
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
import { useTheme } from "next-themes"
import { PERMISSIONS } from "@/lib/permissions"

const sidebarItems = [
    { icon: LayoutDashboard, label: "Overview", href: "/dashboard" },
    { icon: Database, label: "Sources", href: "/dashboard/sources", permission: PERMISSIONS.SOURCES.READ },
    { icon: HardDrive, label: "Destinations", href: "/dashboard/destinations", permission: PERMISSIONS.DESTINATIONS.READ },
    { icon: Bell, label: "Notifications", href: "/dashboard/notifications", permission: PERMISSIONS.NOTIFICATIONS.READ },
    { icon: CalendarClock, label: "Jobs", href: "/dashboard/jobs", permission: PERMISSIONS.JOBS.READ },
    { icon: FolderOpen, label: "Storage Explorer", href: "/dashboard/storage", permission: PERMISSIONS.STORAGE.READ },
    { icon: History, label: "History", href: "/dashboard/history", permission: PERMISSIONS.HISTORY.READ },
    { icon: Lock, label: "Vault", href: "/dashboard/vault", permission: PERMISSIONS.VAULT.READ },
    { icon: Users, label: "Users", href: "/dashboard/users", permission: PERMISSIONS.USERS.READ },
    { icon: Settings, label: "Settings", href: "/dashboard/settings", permission: PERMISSIONS.SETTINGS.READ },
]

export function Sidebar({ permissions = [] }: { permissions?: string[] }) {
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
        <div className="w-64 border-r bg-background h-screen flex flex-col hidden md:flex sticky top-0">
            <div className="h-16 flex items-center px-6 border-b">
                <h1 className="text-xl font-bold tracking-tight">Backup Manager</h1>
            </div>
            <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                {sidebarItems.map((item) => {
                    // Check if item requires specific permission
                    if (item.permission && !permissions.includes(item.permission)) {
                        // Special check for Users page: it requires EITHER USERS.READ OR GROUPS.READ
                        if (item.href === "/dashboard/users") {
                            const hasGroupRead = permissions.includes(PERMISSIONS.GROUPS.READ);
                            if (!hasGroupRead) return null;
                        } else {
                            return null;
                        }
                    }

                    return (
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
                    )
                })}
            </nav>
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
                                <Avatar className="h-8 w-8 rounded-lg">
                                    <AvatarImage src={session.user.image || ""} alt={session.user.name} />
                                    <AvatarFallback className="rounded-lg">{getInitials(session.user.name)}</AvatarFallback>
                                </Avatar>
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
                                    <Avatar className="h-8 w-8 rounded-lg">
                                        <AvatarImage src={session.user.image || ""} alt={session.user.name} />
                                        <AvatarFallback className="rounded-lg">{getInitials(session.user.name)}</AvatarFallback>
                                    </Avatar>
                                    <div className="grid flex-1 text-left text-sm leading-tight">
                                        <span className="truncate font-semibold">{session.user.name}</span>
                                        <span className="truncate text-xs text-muted-foreground">{session.user.email}</span>
                                    </div>
                                </div>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                             <DropdownMenuGroup>
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
