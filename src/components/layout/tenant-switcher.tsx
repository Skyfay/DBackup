"use client"

import { useCallback, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ChevronsUpDown, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { getTenantSummaries, switchTenant } from "@/app/actions/tenant/tenant"
import { NewTenantDialog } from "@/components/dashboard/tenants/tenant-dialogs"
import { announceTenantSwitch, TenantSync } from "@/components/tenant/tenant-sync"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { wrapError } from "@/lib/logging/errors"
import { logger } from "@/lib/logging/logger"
import { ALL_TENANTS } from "@/lib/tenant/home"
import type { TenantSummary } from "@/services/tenant/tenant-summaries"
import { TenantMenu } from "./tenant-menu"
import { pageAfterSwitch, sidebarHead, type HeadInput, type HeadLines } from "./tenant-switch"

const log = logger.child({ component: "tenant-switcher" })

/** The logo tile and the two lines, the same in the link and in the button of the menu. */
function HeadFace({ lines, switching }: { lines: HeadLines; switching: boolean }) {
    return (
        <>
            {switching ? (
                <span className="flex size-7.5 shrink-0 items-center justify-center" aria-hidden="true">
                    <Loader2 className="size-4 animate-spin text-sidebar-foreground/60" />
                </span>
            ) : lines.logo ? (
                // The logo of the tenant the head names, the DBackup tile while it loads or when it fails.
                <Avatar className="size-7.5 shrink-0 rounded-md">
                    <AvatarImage src={lines.logo} alt="" className="object-contain" />
                    <AvatarFallback className="rounded-md bg-transparent">
                        <Image src="/logo.svg" alt="DBackup Logo" width={30} height={30} className="size-7.5" />
                    </AvatarFallback>
                </Avatar>
            ) : (
                <Image src="/logo.svg" alt="DBackup Logo" width={30} height={30} priority className="size-7.5 shrink-0" />
            )}
            <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold text-sidebar-foreground">{lines.title}</span>
                {lines.subtitle && <span className="truncate text-xs text-sidebar-foreground/60 dark:text-sidebar-foreground/55">{lines.subtitle}</span>}
            </span>
            {lines.chevrons && <ChevronsUpDown className="ml-auto group-data-[collapsible=icon]:hidden" aria-hidden="true" />}
        </>
    )
}

/**
 * The head of the sidebar: the logo tile and where the viewer works. With a tenant to switch to, or
 * for a platform admin, it opens the menu of the tenants, see `TenantMenu`, and otherwise leads to
 * the Overview. A pick switches the session, says so in a toast and loads the page again, or leads
 * to the Overview from the page of a record the next tenant does not hold. The other tabs of the
 * browser follow it, and this one follows theirs. A tenant that is gone meanwhile says so in plain
 * words and leaves the list.
 */
export function SidebarHead(input: HeadInput) {
    const { tenants, activeTenantId, allTenants, isPlatformAdmin } = input
    const seesTenants = input.canSeeTenants ?? isPlatformAdmin
    const router = useRouter()
    const pathname = usePathname()
    const { isMobile, state, setOpenMobile } = useSidebar()
    const [open, setOpen] = useState(false)
    const [switching, setSwitching] = useState(false)
    const [creating, setCreating] = useState(false)
    const [summaries, setSummaries] = useState<Map<string, TenantSummary> | null>(null)
    const [loading, setLoading] = useState(false)
    const lines = sidebarHead(input)
    // Every tab follows a switch made in another, see `TenantSync`.
    const sync = <TenantSync shown={allTenants ? ALL_TENANTS : activeTenantId ?? ""} />

    // The numbers and dots of the tenants, read each time the menu opens, for whoever may see the tenants.
    const loadSummaries = useCallback(async () => {
        setLoading(true)
        try {
            const result = await getTenantSummaries()
            if (result.success) setSummaries(new Map(result.data.map((summary) => [summary.id, summary])))
        } catch (error: unknown) {
            log.warn("Reading the tenant summaries failed", {}, wrapError(error))
        } finally {
            setLoading(false)
        }
    }, [])

    const changeOpen = (next: boolean) => {
        setOpen(next)
        if (next && seesTenants) void loadSummaries()
    }

    const closeOnPhone = () => {
        if (isMobile) setOpenMobile(false)
    }

    const switchTo = async (id: string) => {
        setOpen(false)
        const already = id === ALL_TENANTS ? allTenants : !allTenants && id === activeTenantId
        if (already) return
        setSwitching(true)
        try {
            const result = await switchTenant(id)
            if (!result.success) {
                toast.error(result.error)
                // A tenant deleted or closed meanwhile leaves the list, which the layout reads again.
                router.refresh()
                return
            }
            // The tenant that applies, which for All tenants with one tenant left is the home tenant,
            // by the id of the answer where it names one, else the pick.
            const applied: { id?: string; name: string } = result.data
            const appliedId = applied.id ?? id
            toast.success(appliedId === ALL_TENANTS ? "You see every tenant now" : `You work in ${applied.name} now`)
            announceTenantSwitch(appliedId, applied.name)
            closeOnPhone()
            const target = pageAfterSwitch(pathname)
            if (target) router.push(target)
            router.refresh()
        } catch (error: unknown) {
            log.warn("Switching the tenant failed", { tenantId: id }, wrapError(error))
            toast.error("The tenant could not be opened.")
        } finally {
            setSwitching(false)
        }
    }

    if (!lines.menu) {
        return (
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton size="lg" asChild tooltip={lines.title} className="h-11 hover:bg-transparent active:bg-transparent">
                        <Link href="/dashboard" onClick={closeOnPhone}>
                            <HeadFace lines={lines} switching={false} />
                        </Link>
                    </SidebarMenuButton>
                    {sync}
                </SidebarMenuItem>
            </SidebarMenu>
        )
    }

    const label = [lines.title, lines.subtitle].filter(Boolean).join(", ")
    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <Popover open={open} onOpenChange={changeOpen}>
                    <PopoverTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            tooltip={lines.title}
                            aria-label={`${label}. ${lines.chevrons ? "Switch the tenant" : "Tenants"}`}
                            className="h-11 data-[state=open]:bg-sidebar-accent"
                            disabled={switching}
                        >
                            <HeadFace lines={lines} switching={switching} />
                        </SidebarMenuButton>
                    </PopoverTrigger>
                    <PopoverContent
                        tone="pick"
                        side={isMobile || state === "expanded" ? "bottom" : "right"}
                        align="start"
                        className="w-75 max-w-[calc(100vw-2rem)] overflow-hidden p-1"
                    >
                        <TenantMenu
                            tenants={tenants}
                            activeTenantId={activeTenantId}
                            allTenants={allTenants}
                            isPlatformAdmin={isPlatformAdmin}
                            opensAllTenants={input.opensAllTenants}
                            canSeeTenants={input.canSeeTenants}
                            canCreateTenants={input.canCreateTenants}
                            summaries={summaries}
                            loading={loading}
                            onPickAll={() => void switchTo(ALL_TENANTS)}
                            onPick={(tenant) => void switchTo(tenant.id)}
                            onNewTenant={() => {
                                setOpen(false)
                                setCreating(true)
                            }}
                            onManage={() => {
                                setOpen(false)
                                closeOnPhone()
                                router.push("/dashboard/platform/tenants")
                            }}
                        />
                    </PopoverContent>
                </Popover>
                {creating && (
                    <NewTenantDialog
                        onClose={() => setCreating(false)}
                        onSaved={(tenant) => {
                            setCreating(false)
                            closeOnPhone()
                            // A new tenant has nobody in it yet, so its members come next.
                            router.push(`/dashboard/platform/tenants?open=${encodeURIComponent(tenant.id)}`)
                            router.refresh()
                        }}
                    />
                )}
                {sync}
            </SidebarMenuItem>
        </SidebarMenu>
    )
}
