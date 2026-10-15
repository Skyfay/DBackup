"use client";

import { useId, useState } from "react";
import { Info, Lock, Search } from "lucide-react";
import { countLine } from "@/components/layout/tenant-switch";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { PlatformGroupTenant } from "@/services/user/platform-groups-types";

/** Where a platform group counts, as the editor holds it. */
export interface ScopeValue {
    allTenants: boolean;
    tenantIds: string[];
}

interface ScopePaneProps {
    value: ScopeValue;
    onChange: (next: ScopeValue) => void;
    tenants: readonly PlatformGroupTenant[];
    /** Why All tenants may not be picked, null when it may. */
    allLock: string | null;
    /** Why a tenant may not be picked, null when it may. */
    tenantLock: (tenantId: string) => string | null;
    /** Shows the scope without a way to change it. */
    readOnly?: boolean;
    eyebrow?: React.ReactNode;
}

const CARD = "rounded-lg border p-3 transition-colors has-data-[state=checked]:border-tone-control/60 has-data-[state=checked]:bg-tone-control/5 dark:has-data-[state=checked]:bg-tone-control/10";

/**
 * Where the rights of a platform group in the tenants count: every tenant, the ones made later
 * too, or the tenants ticked in the list, with a search, what each holds and Tick all. A tenant or
 * All tenants the viewer may not give stays, locked, with why.
 */
export function ScopePane({ value, onChange, tenants, allLock, tenantLock, readOnly = false, eyebrow }: ScopePaneProps) {
    const id = useId();
    const [query, setQuery] = useState("");
    const shown = tenants.filter((tenant) => tenant.name.toLowerCase().includes(query.trim().toLowerCase()));
    const pickable = shown.filter((tenant) => tenantLock(tenant.id) === null);
    const toggle = (tenantId: string, on: boolean) =>
        onChange({ allTenants: false, tenantIds: on ? [...new Set([...value.tenantIds, tenantId])] : value.tenantIds.filter((entry) => entry !== tenantId) });

    return (
        <div className="space-y-4 p-5">
            {eyebrow}
            <div>
                <h3 className="text-base font-semibold">Where</h3>
                <p className="text-xs text-muted-foreground">In which tenants the rights of this part count</p>
            </div>

            <RadioGroup
                value={value.allTenants ? "all" : "selected"}
                onValueChange={(next) => onChange({ allTenants: next === "all", tenantIds: value.tenantIds })}
                disabled={readOnly}
                className="gap-3"
            >
                <Label htmlFor={`${id}-all`} className={cn(CARD, "cursor-pointer items-start gap-3 leading-normal font-normal has-disabled:cursor-default")}>
                    <RadioGroupItem id={`${id}-all`} value="all" disabled={readOnly || allLock !== null} className="mt-0.5 shrink-0" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="text-sm font-medium">All tenants</span>
                        <span className="text-xs text-muted-foreground">
                            The {tenants.length.toLocaleString("en-US")} of today and every new one, the home tenant included. Members also get All tenants in the switcher when they see something there.
                        </span>
                        {allLock && !readOnly && (
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Lock className="size-3 shrink-0" aria-hidden="true" />
                                {allLock}
                            </span>
                        )}
                    </span>
                </Label>

                <div className={CARD}>
                    <Label htmlFor={`${id}-selected`} className="cursor-pointer items-start gap-3 leading-normal font-normal has-disabled:cursor-default">
                        <RadioGroupItem id={`${id}-selected`} value="selected" className="mt-0.5 shrink-0" />
                        <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className="text-sm font-medium">Selected tenants</span>
                            <span className="text-xs text-muted-foreground">Only the ones ticked. A new tenant stays out until someone ticks it here.</span>
                        </span>
                    </Label>

                    {!value.allTenants && (
                        <div className="mt-3 overflow-hidden rounded-lg border bg-card">
                            <div className="border-b p-2">
                                <div className="relative">
                                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                    <Input
                                        value={query}
                                        onChange={(event) => setQuery(event.target.value)}
                                        placeholder="Find a tenant"
                                        aria-label="Find a tenant"
                                        className="h-8 pl-8 sm:max-w-72"
                                    />
                                </div>
                            </div>
                            <ul className="divide-y">
                                {shown.map((tenant) => {
                                    const lock = tenantLock(tenant.id);
                                    const picked = value.tenantIds.includes(tenant.id);
                                    const box = `${id}-${tenant.id}`;
                                    return (
                                        <li key={tenant.id}>
                                            <label htmlFor={box} className={cn("flex min-w-0 items-center gap-3 px-3 py-2.5", !readOnly && lock === null && "cursor-pointer hover:bg-muted/40")}>
                                                <Checkbox
                                                    id={box}
                                                    checked={picked}
                                                    disabled={readOnly || (lock !== null && !picked)}
                                                    onCheckedChange={(checked) => toggle(tenant.id, checked === true)}
                                                />
                                                <TenantTileMark name={tenant.name} />
                                                <span className="min-w-0 flex-1">
                                                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                                                        <span className="truncate">{tenant.name}</span>
                                                        {tenant.isHome && <span className="shrink-0 text-xs font-normal text-muted-foreground">Home</span>}
                                                    </span>
                                                    {lock && !readOnly && <span className="block truncate text-xs text-muted-foreground">{lock}</span>}
                                                </span>
                                                <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">{countLine(tenant)}</span>
                                            </label>
                                        </li>
                                    );
                                })}
                                {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No tenant matches.</li>}
                            </ul>
                            <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                                <span className="tabular-nums">
                                    {value.tenantIds.length} of {tenants.length} {tenants.length === 1 ? "tenant" : "tenants"}
                                </span>
                                {!readOnly && pickable.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => onChange({ allTenants: false, tenantIds: [...new Set([...value.tenantIds, ...pickable.map((tenant) => tenant.id)])] })}
                                        className="rounded-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                                    >
                                        Tick all
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </RadioGroup>

            <p className="flex gap-2.5 rounded-lg border bg-muted/30 p-3 text-xs">
                <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>In the other tenants this group gives nothing. A member who has a group there of their own keeps it.</span>
            </p>
        </div>
    );
}

/** "All tenants", "2 tenants" or "No tenant", the level the list of areas shows beside Where. */
export function scopeLabel(value: ScopeValue): string {
    if (value.allTenants) return "All tenants";
    const count = value.tenantIds.length;
    return count === 0 ? "No tenant" : `${count} ${count === 1 ? "tenant" : "tenants"}`;
}

