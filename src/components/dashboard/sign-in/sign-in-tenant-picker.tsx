"use client";

import { useState } from "react";
import { Building2, Globe } from "lucide-react";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { SsoTenant } from "@/services/sso/sso-providers-types";

/** The entry of the platform in the list, which belongs to no tenant. */
const PLATFORM_ENTRY = "platform";

interface BelongsToPickerProps {
    id?: string;
    /** Every tenant, the home tenant among them, which stands for the platform. */
    tenants: SsoTenant[];
    /** The tenant the provider belongs to, null for the platform. */
    value: string | null;
    onChange: (tenantId: string | null) => void;
    disabled?: boolean;
}

/**
 * Picks who a sign-in provider belongs to: the platform, whose providers are buttons on the login
 * page and add people to the home tenant, or a tenant, whose provider only the email reaches.
 */
export function BelongsToPicker({ id, tenants, value, onChange, disabled }: BelongsToPickerProps) {
    const [open, setOpen] = useState(false);
    const home = tenants.find((tenant) => tenant.id === HOME_TENANT_ID);
    const customers = tenants.filter((tenant) => tenant.id !== HOME_TENANT_ID);
    const platform: PickEntry = {
        id: PLATFORM_ENTRY,
        name: "Platform",
        meta: home ? `A button on the login page, new people land in ${home.name}` : "A button on the login page",
        glyph: Globe,
    };
    const entries: PickEntry[] = customers.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        meta: "Reached by the email only, new people land in this tenant",
        icon: <TenantTileMark name={tenant.name} className="size-8 border-0 bg-transparent" />,
    }));
    const current = value ? customers.find((tenant) => tenant.id === value) : null;

    return (
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <PickTrigger
                    id={id}
                    icon={Globe}
                    leading={current ? <TenantTileMark name={current.name} className="size-5 rounded-sm text-[9px]" /> : undefined}
                    aria-expanded={open}
                    disabled={disabled}
                    className="w-full"
                >
                    <span className="truncate">{current ? current.name : "Platform"}</span>
                    <span className="hidden truncate text-xs text-muted-foreground sm:inline">{current ? "a tenant" : "every tenant's login page"}</span>
                </PickTrigger>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                <PickList
                    icon={Building2}
                    title="Who it belongs to"
                    note="The platform, or the tenant whose people sign in through it"
                    groups={[{ entries: [platform] }, { heading: "Tenants", entries }]}
                    value={value ?? PLATFORM_ENTRY}
                    emptyText="No tenant matches."
                    searchPlaceholder="Find a tenant"
                    onPick={(picked) => {
                        onChange(picked === PLATFORM_ENTRY ? null : picked);
                        setOpen(false);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}
