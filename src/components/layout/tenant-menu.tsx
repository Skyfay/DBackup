"use client"

import { Check, Plus, Settings } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Skeleton } from "@/components/ui/skeleton"
import { toneAttribute } from "@/components/ui/tone"
import { cn } from "@/lib/utils"
import type { TenantSummary } from "@/services/tenant/tenant-summaries"
import { countLine, healthNote, isHomeTenant, offersAllTenants, searchesTenants, tenantInitials, type HeadTenant } from "./tenant-switch"

/** The value of the entry All tenants, which no name of a tenant can take, since those carry their id. */
const ALL_VALUE = "All tenants"

/** The value cmdk filters and marks a tenant by, its name for the search and its id to keep it apart. */
export const tenantValue = (tenant: HeadTenant) => `${tenant.name} ${tenant.id}`

/** A row of the menu in the look of a menu entry with a tone, highlighted with a frame and a tint. */
const TONED_ROW = "border border-transparent text-tone data-[selected=true]:border-tone/50 data-[selected=true]:bg-tone/5 data-[selected=true]:text-tone dark:data-[selected=true]:bg-tone/10"

/** The 26 px tile of a row: the logo or the initials of a tenant, or All in the tone of the menu. */
function RowTile({ children, all = false, logo = null }: { children: React.ReactNode; all?: boolean; logo?: string | null }) {
    if (logo) {
        return (
            <Avatar className="size-6.5 shrink-0 rounded-md" aria-hidden="true">
                <AvatarImage src={logo} alt="" className="object-contain" />
                <AvatarFallback className="rounded-md bg-muted text-[10.5px] font-bold text-muted-foreground">{children}</AvatarFallback>
            </Avatar>
        )
    }
    return (
        <span
            className={cn(
                "flex size-6.5 shrink-0 items-center justify-center rounded-md text-[10.5px] font-bold",
                all ? "bg-tone/14 text-tone" : "bg-muted text-muted-foreground"
            )}
            aria-hidden="true"
        >
            {children}
        </span>
    )
}

function Picked() {
    return (
        <>
            <Check className="size-4 text-foreground" aria-hidden="true" />
            <span className="sr-only">, open now</span>
        </>
    )
}

interface TenantMenuProps {
    tenants: readonly HeadTenant[]
    /** The tenant the viewer works in, null in All tenants. */
    activeTenantId: string | null
    allTenants: boolean
    isPlatformAdmin: boolean
    /** May open All tenants. As `isPlatformAdmin` when left out. */
    opensAllTenants?: boolean
    /** May see the tenants with their numbers and Manage tenants. As `isPlatformAdmin` when left out. */
    canSeeTenants?: boolean
    /** May create tenants, New tenant. As `isPlatformAdmin` when left out. */
    canCreateTenants?: boolean
    /** The jobs, databases and health of each tenant, null while they load or for whoever may not see the tenants. */
    summaries: Map<string, TenantSummary> | null
    /** The summaries are on their way, for whoever may see the tenants. */
    loading: boolean
    onPickAll: () => void
    onPick: (tenant: HeadTenant) => void
    onNewTenant: () => void
    onManage: () => void
}

/**
 * The menu of the head of the sidebar: a search, All tenants for whoever may open it, the tenants
 * with their numbers and a dot while the newest backup of a job failed or missed a copy, then New
 * tenant for whoever may create tenants and Manage tenants for whoever may see them. Someone else
 * sees the names of their tenants.
 */
export function TenantMenu(props: TenantMenuProps) {
    const { tenants, activeTenantId, allTenants, isPlatformAdmin, summaries, loading, onPickAll, onPick, onNewTenant, onManage } = props
    const seesTenants = props.canSeeTenants ?? isPlatformAdmin
    const createsTenants = props.canCreateTenants ?? isPlatformAdmin
    const active = tenants.find((tenant) => tenant.id === activeTenantId)
    const current = allTenants ? ALL_VALUE : active ? tenantValue(active) : undefined
    const showAll = offersAllTenants(props.opensAllTenants ?? isPlatformAdmin, tenants.length)

    return (
        <Command defaultValue={current} className="bg-transparent">
            {searchesTenants(tenants.length) && (
                <CommandInput
                    placeholder="Find a tenant"
                    aria-label="Find a tenant"
                    wrapperClassName="m-0.5 mb-1.5 h-8 rounded-md border border-input px-2 focus-within:border-tone-ring focus-within:ring-2 focus-within:ring-tone-ring/50 dark:bg-input/30"
                    className="h-8 py-0 text-[13px]"
                />
            )}
            <CommandList scrollClassName="*:data-[slot=scroll-area-viewport]:max-h-[min(22rem,calc(100dvh-14rem))]">
                <CommandEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">No tenant matches.</CommandEmpty>
                {showAll && (
                    <CommandGroup className="p-0">
                        <CommandItem value={ALL_VALUE} keywords={["every", "msp"]} onSelect={onPickAll} className="h-10 gap-2.5 px-2">
                            <RowTile all>All</RowTile>
                            <span className="min-w-0 flex-1 leading-tight">
                                <span className="block truncate text-[13.5px]">All tenants</span>
                                <span className="block truncate text-xs text-muted-foreground">the MSP view, every tenant at once</span>
                            </span>
                            {allTenants && <Picked />}
                        </CommandItem>
                    </CommandGroup>
                )}
                {showAll && <CommandSeparator className="my-1" />}
                <CommandGroup heading="Tenants" className="p-0">
                    {tenants.map((tenant) => {
                        const summary = summaries?.get(tenant.id)
                        const note = healthNote(summary?.health)
                        const home = seesTenants && isHomeTenant(tenant.id)
                        const line = [home ? "Home" : null, summary ? countLine(summary) : null].filter(Boolean).join(" · ")
                        return (
                            <CommandItem key={tenant.id} value={tenantValue(tenant)} onSelect={() => onPick(tenant)} className="h-10 gap-2.5 px-2">
                                <RowTile logo={tenant.logo}>{tenantInitials(tenant.name)}</RowTile>
                                <span className="min-w-0 flex-1 leading-tight">
                                    <span className="block truncate text-[13.5px]">{tenant.name}</span>
                                    {line ? (
                                        <span className="block truncate text-xs text-muted-foreground">{line}</span>
                                    ) : (
                                        seesTenants && loading && <Skeleton className="mt-1 h-2.5 w-24" />
                                    )}
                                </span>
                                {note && (
                                    <span title={note} className={cn("size-1.75 shrink-0 rounded-full", summary?.health === "failed" ? "bg-destructive" : "bg-warning")}>
                                        <span className="sr-only">, {note}</span>
                                    </span>
                                )}
                                {!allTenants && tenant.id === activeTenantId && <Picked />}
                            </CommandItem>
                        )
                    })}
                </CommandGroup>
                {seesTenants && (
                    <>
                        <CommandSeparator className="my-1" alwaysRender />
                        <CommandGroup forceMount className="p-0">
                            {createsTenants && (
                                <CommandItem forceMount value="New tenant" onSelect={onNewTenant} {...toneAttribute("create")} className={cn("h-8 gap-2.25 px-2 text-[13.5px]", TONED_ROW)}>
                                    <Plus className="text-tone" aria-hidden="true" />
                                    New tenant
                                </CommandItem>
                            )}
                            <CommandItem forceMount value="Manage tenants" onSelect={onManage} className="h-8 gap-2.25 px-2 text-[13.5px]">
                                <Settings aria-hidden="true" />
                                Manage tenants
                            </CommandItem>
                        </CommandGroup>
                    </>
                )}
            </CommandList>
        </Command>
    )
}
