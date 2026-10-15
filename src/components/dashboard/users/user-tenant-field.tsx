"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { TenantPickList, TenantTileMark } from "@/components/tenant/tenant-pick";
import type { ViewTenant } from "@/components/tenant/tenant-view";
import type { Button } from "@/components/ui/button";
import { PickTrigger } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface TenantFieldProps extends Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> {
    /** The tenants to pick from, in the order they are listed. */
    tenants: ViewTenant[];
    /** The id of the tenant, or an empty string while nothing is picked. */
    value: string;
    onChange: (tenantId: string) => void;
    placeholder?: string;
}

/**
 * Picks a tenant, like the group field beside it: the tenants in a list with a search. The props
 * of a form field land on the button, so its label names it.
 */
export function TenantField({ tenants, value, onChange, placeholder = "Pick a tenant", ...props }: TenantFieldProps) {
    const [open, setOpen] = useState(false);
    const current = tenants.find((tenant) => tenant.id === value);

    return (
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <PickTrigger
                    icon={Building2}
                    leading={current ? <TenantTileMark name={current.name} className="size-5 rounded text-[9px]" /> : undefined}
                    aria-expanded={open}
                    {...props}
                >
                    {current ? <span className="truncate">{current.name}</span> : <span className="truncate text-muted-foreground">{placeholder}</span>}
                </PickTrigger>
            </PopoverTrigger>
            {/* On the raised surface, so it stands out from the dialog or the panel it opens over. */}
            <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-72 overflow-hidden bg-raised p-0">
                <TenantPickList
                    tenants={tenants}
                    className="p-1"
                    onPick={(tenant) => {
                        onChange(tenant.id);
                        setOpen(false);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}
