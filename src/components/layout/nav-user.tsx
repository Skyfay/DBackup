"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { ArrowUpRight, BookOpen, FileCode2, Globe, LogOut, Monitor, Moon, MoreHorizontal, Palette, ShieldCheck, Sparkles, Sun, SunMoon, User, type LucideIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useSession, signOut } from "@/lib/auth/client"
import { SKIP_SSO_AUTO_REDIRECT_KEY } from "@/components/auth/login-form"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RowMenuHead } from "@/components/ui/row-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"

interface NavUserProps {
    /** Shown under the name. Falls back to the email for users without a group. */
    groupName?: string;
    /** The version of this DBackup, named by What's new. */
    version?: string;
}

const THEMES: { value: string; label: string; icon: LucideIcon }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
]

const HELP: { href: string; label: string; icon: LucideIcon }[] = [
    { href: "https://docs.dbackup.app", label: "Guides", icon: BookOpen },
    { href: "/docs/api", label: "API reference", icon: FileCode2 },
    { href: "https://api.dbackup.app", label: "API reference online", icon: Globe },
]

const CHANGELOG = "https://docs.dbackup.app/changelog"

function getInitials(name?: string) {
    if (!name) return "U";
    return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .substring(0, 2);
}

export function NavUser({ groupName, version }: NavUserProps) {
    const { data: session, isPending } = useSession()
    const { isMobile, setOpenMobile } = useSidebar()
    const router = useRouter()
    const { theme, setTheme } = useTheme()

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
    const secondFactor = !!user.twoFactorEnabled || !!(user as { passkeyTwoFactor?: boolean | null }).passkeyTwoFactor
    const closeOnPhone = () => isMobile && setOpenMobile(false)

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
                        className="w-68"
                        side={isMobile ? "top" : "right"}
                        align="end"
                        sideOffset={4}
                    >
                        <RowMenuHead
                            tile={<Avatar className="size-8"><AvatarImage src={user.image || ""} alt="" /><AvatarFallback className="text-xs">{getInitials(user.name)}</AvatarFallback></Avatar>}
                            title={user.name}
                            note={[groupName, user.email].filter(Boolean).join(" · ")}
                        />
                        <DropdownMenuLabel className="text-xs text-muted-foreground">Account</DropdownMenuLabel>
                        <DropdownMenuItem asChild tone="neutral">
                            <Link href="/dashboard/profile" onClick={closeOnPhone}>
                                <User />
                                Profile
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild tone="neutral">
                            <Link href="/dashboard/profile?part=security" onClick={closeOnPhone}>
                                <ShieldCheck />
                                Security
                                {secondFactor && <span className="ml-auto text-xs text-success"><span className="sr-only">, </span>2FA on</span>}
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild tone="neutral">
                            <Link href="/dashboard/profile?part=colors" onClick={closeOnPhone}>
                                <Palette />
                                Colors
                            </Link>
                        </DropdownMenuItem>
                        {/* A switch rather than a submenu, and it keeps the menu open, so the change shows at once. */}
                        <div className="flex items-center justify-between gap-2 py-1 pr-1 pl-2 text-sm">
                            <span className="flex items-center gap-2">
                                <SunMoon className="size-4 text-muted-foreground" aria-hidden="true" />
                                Theme
                            </span>
                            <DropdownMenuPrimitive.RadioGroup value={theme ?? "system"} onValueChange={setTheme} aria-label="Theme" className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
                                {THEMES.map((option) => (
                                    <DropdownMenuPrimitive.RadioItem
                                        key={option.value}
                                        value={option.value}
                                        aria-label={option.label}
                                        title={option.label}
                                        onSelect={(event) => event.preventDefault()}
                                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors data-[highlighted]:text-foreground data-[highlighted]:ring-2 data-[highlighted]:ring-ring/50 data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm dark:data-[state=checked]:bg-foreground/12"
                                    >
                                        <option.icon className="size-4" aria-hidden="true" />
                                    </DropdownMenuPrimitive.RadioItem>
                                ))}
                            </DropdownMenuPrimitive.RadioGroup>
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs text-muted-foreground">Help</DropdownMenuLabel>
                        {HELP.map((link) => (
                            <DropdownMenuItem key={link.href} asChild tone="neutral">
                                <a href={link.href} target="_blank" rel="noopener noreferrer">
                                    <link.icon />
                                    {link.label}
                                    <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground" aria-hidden="true" />
                                </a>
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem asChild tone="neutral">
                            <a href={CHANGELOG} target="_blank" rel="noopener noreferrer">
                                <Sparkles />
                                {version ? `What's new in v${version}` : "What's new"}
                                <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground" aria-hidden="true" />
                            </a>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" tone="destructive" onSelect={() => void handleSignOut()}>
                            <LogOut />
                            Log out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    )
}
