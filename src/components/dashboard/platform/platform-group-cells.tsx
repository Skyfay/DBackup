"use client";

import { Globe, Lock } from "lucide-react";
import { countLine } from "@/components/layout/tenant-switch";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DateDisplay } from "@/components/utils/date-display";
import { listWords } from "@/lib/auth/access-summary";
import { cn } from "@/lib/utils";
import type { PlatformGroupRow, PlatformGroupTenant } from "@/services/user/platform-groups-types";

const TILE_SIZES = { sm: ["size-7", "size-3.5"], md: ["size-8", "size-4"], lg: ["size-11", "size-5"] } as const;

/** A platform group as a tile: a lock for the built-in Platform admin, a globe for the others. */
export function PlatformGroupTile({ group, size = "md" }: { group: Pick<PlatformGroupRow, "builtIn">; size?: keyof typeof TILE_SIZES }) {
    const [box, icon] = TILE_SIZES[size];
    const Icon = group.builtIn ? Lock : Globe;
    return (
        <span className={cn("flex shrink-0 items-center justify-center rounded-lg border bg-muted/50", box)} aria-hidden="true">
            <Icon className={icon} />
        </span>
    );
}

/** The platform group of an account as a chip: Platform admin with a lock, another with a globe, or None. */
export function PlatformGroupTag({ user }: { user: { superAdmin: boolean; platformGroup?: { name: string } | null } }) {
    if (!user.superAdmin && !user.platformGroup) return <span className="text-sm text-muted-foreground">None</span>;
    const Icon = user.superAdmin ? Lock : Globe;
    return (
        <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{user.superAdmin ? "Platform admin" : user.platformGroup?.name}</span>
        </span>
    );
}

/** The small mark of the built-in Platform admin. */
export function BuiltInTag() {
    return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            Built in
        </span>
    );
}

/** "built in, holds every right", or when the group was made and by whom. */
export function PlatformGroupMade({ group }: { group: PlatformGroupRow }) {
    if (group.builtIn) return <>built in, holds every right</>;
    return (
        <>
            made <DateDisplay date={group.made?.at ?? group.createdAt} format="P" />
            {group.made?.by && ` by ${group.made.by}`}
        </>
    );
}

/** The tenants of the scope by their ids, the home tenant first, as the model lists them. */
export function scopeTenants(group: Pick<PlatformGroupRow, "allTenants" | "tenantIds">, tenants: readonly PlatformGroupTenant[]): PlatformGroupTenant[] {
    return group.allTenants ? [...tenants] : tenants.filter((tenant) => group.tenantIds.includes(tenant.id));
}

/** The first word of each name, like "Acme, Baeckerei, Praxis", for the line under the scope. */
const shortNames = (tenants: readonly PlatformGroupTenant[]) => tenants.map((tenant) => tenant.name.split(/\s+/)[0]).join(", ");

/**
 * Where a platform group counts: All tenants with how many there are today, or the tiles of its
 * tenants with their number and their names, which a hover lists with what each holds.
 */
export function WhereCell({ group, tenants }: { group: PlatformGroupRow; tenants: readonly PlatformGroupTenant[] }) {
    if (group.tenantPermissions.length === 0 && !group.builtIn) {
        return <span className="text-sm text-muted-foreground">nowhere, no rights in the tenants</span>;
    }
    if (group.allTenants) {
        return (
            <div className="min-w-0">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                    <Globe className="size-3.5" aria-hidden="true" />
                    All tenants
                </span>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{tenants.length.toLocaleString("en-US")} today, new ones too</div>
            </div>
        );
    }
    const inScope = scopeTenants(group, tenants);
    const outside = tenants.filter((tenant) => !group.tenantIds.includes(tenant.id));
    // Tenants the viewer may not open themselves count, but stay unnamed.
    const count = group.tenantIds.length;
    const unnamed = count - inScope.length;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button type="button" className="min-w-0 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    <span className="flex items-center gap-2">
                        <span className="flex shrink-0 gap-0.5">
                            {inScope.slice(0, 3).map((tenant) => <TenantTileMark key={tenant.id} name={tenant.name} className="size-5 rounded text-[9px]" />)}
                        </span>
                        <span className="text-sm font-medium whitespace-nowrap">{count} {count === 1 ? "tenant" : "tenants"}</span>
                    </span>
                    <span className="mt-0.5 block max-w-44 truncate text-xs text-muted-foreground">{shortNames(inScope)}</span>
                </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="w-72 max-w-[calc(100vw-2rem)] p-3">
                <p className="text-sm font-semibold">{group.name} counts in {count} {count === 1 ? "tenant" : "tenants"}</p>
                <ul className="mt-2 space-y-1.5">
                    {inScope.map((tenant) => (
                        <li key={tenant.id} className="flex items-center gap-2 text-sm">
                            <TenantTileMark name={tenant.name} className="size-5 rounded text-[9px]" />
                            <span className="min-w-0 flex-1 truncate">{tenant.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{countLine(tenant).split(" · ")[0]}</span>
                        </li>
                    ))}
                </ul>
                {unnamed > 0 && <p className="mt-1.5 text-xs text-muted-foreground">and {unnamed} you do not open yourself</p>}
                <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                    {outside.length > 0 ? `Not in ${listWords(outside.map((tenant) => tenant.name))}, and not` : "Not"} in a new tenant until it is added.
                </p>
            </TooltipContent>
        </Tooltip>
    );
}

/** A line of what a group does with the levels of its areas under it, like "Sees the tenants" over "Tenants See". */
export function RightsCell({ line, levels }: { line: string; levels: string }) {
    return (
        <div className="max-w-sm min-w-0">
            <div className="truncate text-sm" title={line}>{line}</div>
            {levels && <div className="truncate text-xs text-muted-foreground" title={levels}>{levels}</div>}
        </div>
    );
}
