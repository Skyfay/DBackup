"use client";

import { useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { tenantInitials, isHomeTenant } from "@/components/layout/tenant-switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useOpenInTenant, useTenantView, type ViewTenant } from "./tenant-view";

const TILE = "flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted text-[11px] font-semibold text-muted-foreground";

/** The logo of a tenant on a small tile, its initials without one or while the logo loads. */
export function TenantTileMark({ name, logo = null, className }: { name: string; logo?: string | null; className?: string }) {
    if (logo) {
        return (
            <Avatar className={cn(TILE, "overflow-hidden bg-card", className)} aria-hidden="true">
                <AvatarImage src={logo} alt="" className="object-contain" />
                <AvatarFallback className="rounded-none bg-muted">{tenantInitials(name)}</AvatarFallback>
            </Avatar>
        );
    }
    return (
        <span className={cn(TILE, className)} aria-hidden="true">
            {tenantInitials(name)}
        </span>
    );
}

interface TenantPickListProps {
    tenants: ViewTenant[];
    onPick: (tenant: ViewTenant) => void;
    /** The tenant that opens now, with a spinner, while every row waits. */
    busyId?: string | null;
    className?: string;
}

/** The tenants with a search, for picking the one a page or a new record belongs to. */
export function TenantPickList({ tenants, onPick, busyId = null, className }: TenantPickListProps) {
    return (
        <Command className={cn("bg-transparent", className)}>
            <CommandInput placeholder="Find a tenant" />
            <CommandList scrollClassName="*:data-[slot=scroll-area-viewport]:max-h-80">
                <CommandEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">No tenant matches.</CommandEmpty>
                <CommandGroup>
                    {tenants.map((tenant) => (
                        <CommandItem
                            key={tenant.id}
                            value={`${tenant.name} ${tenant.id}`}
                            disabled={busyId !== null}
                            onSelect={() => onPick(tenant)}
                            className="gap-2.5 px-2 py-2"
                        >
                            <TenantTileMark name={tenant.name} logo={tenant.logo} />
                            <span className="min-w-0 flex-1 truncate font-medium">{tenant.name}</span>
                            {isHomeTenant(tenant.id) && <span className="shrink-0 text-xs text-muted-foreground">Home</span>}
                            {busyId === tenant.id && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Opening" />}
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}

interface TenantPickDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** What the pick is for, like "New job". */
    title: string;
    /** One line under the title, like "A job belongs to one tenant". */
    description: string;
    /** The page that opens in the picked tenant, like the form of a new job. */
    href: string;
    /** The tenants to offer, like the ones where the viewer may add the record. Every tenant of the view when left out. */
    tenants?: ViewTenant[];
}

/**
 * Asks which tenant a new record belongs to, in All tenants, then opens its form in that tenant.
 * A record is made in its tenant, where everything it links to is checked against that tenant.
 */
export function TenantPickDialog({ open, onOpenChange, title, description, href, tenants: offered }: TenantPickDialogProps) {
    const view = useTenantView();
    const tenants = offered ?? view.tenants;
    const openInTenant = useOpenInTenant();
    const [busyId, setBusyId] = useState<string | null>(null);

    const pick = async (tenant: ViewTenant) => {
        setBusyId(tenant.id);
        try {
            if (await openInTenant(tenant.id, href)) onOpenChange(false);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => busyId === null && onOpenChange(next)}>
            <DialogContent tone="pick" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-md")}>
                <DialogHead tone="pick" icon={Building2} className="px-5 py-4">
                    <DialogTitle className="text-base">{title}</DialogTitle>
                    <DialogDescription className={dialogNoteClass("pick")}>{description}</DialogDescription>
                </DialogHead>
                <TenantPickList tenants={tenants} onPick={(tenant) => void pick(tenant)} busyId={busyId} className="p-1" />
            </DialogContent>
        </Dialog>
    );
}

interface PickTenantPanelProps {
    /** What the page is, like "The Vault". */
    title: string;
    /** Why it needs one tenant, like "Keys and logins belong to one tenant". */
    description: string;
    /** The page that opens in the picked tenant, usually this one. */
    href: string;
    /** Under the tenants, like a way to what the platform shows of every tenant at once. */
    footer?: React.ReactNode;
}

/**
 * The page of something that belongs to one tenant, in All tenants: it says so and lets the viewer
 * pick the tenant to open it in.
 */
export function PickTenantPanel({ title, description, href, footer }: PickTenantPanelProps) {
    const { tenants } = useTenantView();
    const openInTenant = useOpenInTenant();
    const [busyId, setBusyId] = useState<string | null>(null);

    const pick = async (tenant: ViewTenant) => {
        setBusyId(tenant.id);
        try {
            await openInTenant(tenant.id, href);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <Card className="mx-auto max-w-lg gap-0 overflow-hidden py-0">
            <DialogHead tone="pick" icon={Building2} className="px-5 py-4">
                <h2 className="text-base font-semibold">{title}</h2>
                <p className={dialogNoteClass("pick")}>{description}</p>
            </DialogHead>
            <CardContent className="p-1">
                <TenantPickList tenants={tenants} onPick={(tenant) => void pick(tenant)} busyId={busyId} />
            </CardContent>
            {footer && <div className="border-t px-5 py-3 text-sm text-muted-foreground">{footer}</div>}
        </Card>
    );
}
