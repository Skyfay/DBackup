"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import type { ViewTenant } from "@/components/tenant/tenant-view";
import type { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { UsersGroup } from "@/services/user/users-types";
import { groupsOfTenant } from "./user-access";

/** "Home tenant", "Shares with customers" or "Customer", what a tenant is, without its groups. */
function kindOf(tenant: ViewTenant): string {
    if (tenant.id === HOME_TENANT_ID) return "Home tenant";
    return tenant.sharesWithCustomers ? "Shares with customers" : "Customer";
}

/** "Home tenant · 3 groups: Admin, Client, Viewer", what a tenant is and the groups it offers. */
export function tenantGroupsMeta(groups: UsersGroup[]) {
    return (tenant: ViewTenant) => {
        const offered = groupsOfTenant(groups, tenant.id);
        const names = offered.map((group) => group.name).join(", ");
        return `${kindOf(tenant)} · ${offered.length === 1 ? "1 group" : `${offered.length} groups`}${names ? `: ${names}` : ""}`;
    };
}

interface TenantFieldProps extends Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> {
    /** The tenants to pick from, in the order they are listed. */
    tenants: ViewTenant[];
    /** The id of the tenant, or an empty string while nothing is picked. */
    value: string;
    onChange: (tenantId: string) => void;
    /** The line under a tenant in the list, what it is when left out. */
    metaOf?: (tenant: ViewTenant) => string;
    placeholder?: string;
}

/**
 * Picks a tenant like the group field beside it, in the turquoise of picking: every tenant with
 * its logo or initials and a line about it, and a search. The props of a form field land on the
 * button, so its label names it.
 */
export function TenantField({ tenants, value, onChange, metaOf = kindOf, placeholder = "Pick a tenant", ...props }: TenantFieldProps) {
    const [open, setOpen] = useState(false);
    const current = tenants.find((tenant) => tenant.id === value);
    const entries = tenants.map((tenant): PickEntry => {
        const meta = metaOf(tenant);
        return {
            id: tenant.id,
            name: tenant.name,
            meta,
            keywords: [meta],
            // Two tenants may share a name, so the search and the arrow keys know them apart by id too.
            value: `${tenant.name} ${tenant.id}`,
            icon: <TenantTileMark name={tenant.name} logo={tenant.logo} className="size-6 border-0 bg-transparent text-[10px]" />,
        };
    });

    return (
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <PickTrigger
                    icon={Building2}
                    leading={current ? <TenantTileMark name={current.name} logo={current.logo} className="size-5 rounded text-[9px]" /> : undefined}
                    aria-expanded={open}
                    {...props}
                >
                    {current ? (
                        <>
                            <span className="max-w-full flex-none truncate">{current.name}</span>
                            <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:inline">{metaOf(current)}</span>
                        </>
                    ) : (
                        <span className="truncate text-muted-foreground">{placeholder}</span>
                    )}
                </PickTrigger>
            </PopoverTrigger>
            {/* On the raised surface, so it stands out from the dialog or the panel it opens over. */}
            <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                <PickList
                    icon={Building2}
                    title="Pick a tenant"
                    note="Where they work, with a group there"
                    searchPlaceholder="Find a tenant"
                    groups={[{ entries }]}
                    value={value}
                    emptyText="No tenant matches."
                    onPick={(tenantId) => {
                        onChange(tenantId);
                        setOpen(false);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}
