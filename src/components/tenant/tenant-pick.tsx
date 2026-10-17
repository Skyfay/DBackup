"use client";

import { useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { tenantInitials, isHomeTenant } from "@/components/layout/tenant-switch";
import { PageProblem } from "@/components/layout/page-problem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { oneTenantPage } from "./one-tenant-pages";
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
    /** What the pick is for, like "New job" or "Vault". */
    title: string;
    /** One line under the title, like "A job belongs to one tenant". */
    description: string;
    /** The page that opens in the picked tenant, like the form of a new job or the Vault. */
    href: string;
    /** The tenants to offer, like the ones where the viewer may add the record. Every tenant of the view when left out. */
    tenants?: ViewTenant[];
}

/**
 * Asks which tenant a new record or a page of one tenant belongs to, in All tenants, then opens it
 * in that tenant. A record is made in its tenant, where everything it links to is checked against that tenant.
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

/**
 * The page of something that belongs to one tenant, opened by its address in All tenants, like a
 * bookmark: it says so in the look of an empty list and asks for the tenant at once, in the dialog
 * that its entry in the sidebar opens too.
 */
export function PickTenantPage({ href }: { href: string }) {
    const page = oneTenantPage(href);
    const title = page?.title ?? "This page";
    const description = page?.description ?? "It belongs to one tenant, pick the one to open.";
    const [open, setOpen] = useState(true);

    return (
        <>
            <PageProblem
                icon={Building2}
                title={title}
                actions={
                    <Button tone="pick" onClick={() => setOpen(true)}>
                        <Building2 />
                        Pick a tenant
                    </Button>
                }
            >
                {description}
            </PageProblem>
            <TenantPickDialog open={open} onOpenChange={setOpen} title={title} description={description} href={href} />
        </>
    );
}
