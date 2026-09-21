"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { BookOpen, FileCode2, Globe, LogOut, Monitor, Moon, MoreHorizontal, Sun, User } from "lucide-react"
import { useTheme } from "next-themes"
import { useSession, signOut } from "@/lib/auth/client"
import { SKIP_SSO_AUTO_REDIRECT_KEY } from "@/components/auth/login-form"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"

interface NavUserProps {
    /** Shown under the name. Falls back to the email for users without a group. */
    groupName?: string;
}

function getInitials(name?: string) {
    if (!name) return "U";
    return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .substring(0, 2);
}

export function NavUser({ groupName }: NavUserProps) {
    const { data: session, isPending } = useSession()
    const { isMobile, setOpenMobile } = useSidebar()
    const router = useRouter()
    const { setTheme } = useTheme()

    const handleSignOut = async () => {
        await signOut({
            fetchOptions: {
                onSuccess: () => {
                    // Suppress the OIDC auto-redirect for exactly this one page load.
                    // Without it the still-valid session at the identity provider signs
                    // the user straight back in and logging out is impossible.
                    sessionStorage.setItem(SKIP_SSO_AUTO_REDIRECT_KEY, "1")
                    router.push("/")
                }
            }
        })
    }

    if (isPending) {
        return (
            <div className="flex h-10 items-center gap-2.5 px-1.5 group-data-[collapsible=icon]:size-8.5 group-data-[collapsible=icon]:p-0.5">
                <Skeleton className="size-7.5 shrink-0 rounded-full" />
                <div className="grid flex-1 gap-1.5 group-data-[collapsible=icon]:hidden">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3 w-16" />
                </div>
            </div>
        )
    }

    if (!session) return null

    const { user } = session

    const avatar = (
        <Avatar className="size-7.5">
            <AvatarImage src={user.image || ""} alt={user.name} />
            <AvatarFallback className="bg-sidebar-accent text-[11px] text-sidebar-foreground/80">{getInitials(user.name)}</AvatarFallback>
        </Avatar>
    )

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:[&>svg]:text-sidebar-accent-foreground"
                        >
                            {avatar}
                            <div className="grid flex-1 text-left leading-tight">
                                <span className="truncate text-sidebar-foreground">{user.name}</span>
                                <span className="truncate text-xs text-sidebar-foreground/60 dark:text-sidebar-foreground/55">{groupName || user.email}</span>
                            </div>
                            <MoreHorizontal className="ml-auto" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="min-w-56 rounded-lg"
                        side={isMobile ? "top" : "right"}
                        align="end"
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="p-0 font-normal">
                            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                {avatar}
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-medium">{user.name}</span>
                                    <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                                </div>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem asChild>
                                <Link href="/dashboard/profile" onClick={() => isMobile && setOpenMobile(false)}>
                                    <User />
                                    Profile
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                    <Monitor />
                                    Theme
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent>
                                        <DropdownMenuItem onClick={() => setTheme("light")}>
                                            <Sun />
                                            Light
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setTheme("dark")}>
                                            <Moon />
                                            Dark
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setTheme("system")}>
                                            <Monitor />
                                            System
                                        </DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <BookOpen />
                                Documentation
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                                <DropdownMenuSubContent>
                                    <DropdownMenuItem asChild>
                                        <a href="https://docs.dbackup.app" target="_blank" rel="noopener noreferrer">
                                            <BookOpen />
                                            Guides
                                        </a>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild>
                                        <a href="/docs/api" target="_blank" rel="noopener noreferrer">
                                            <FileCode2 />
                                            API Docs (Local)
                                        </a>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild>
                                        <a href="https://api.dbackup.app" target="_blank" rel="noopener noreferrer">
                                            <Globe />
                                            API Docs (Remote)
                                        </a>
                                    </DropdownMenuItem>
                                </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleSignOut}>
                            <LogOut />
                            Log out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    )
}
