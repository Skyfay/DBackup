"use client";

import { useState } from "react";
import { Building2, Eye, Loader2, Lock, Network, Pencil, Share2, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { renameTenant, setTenantAllowances, setTenantNetwork, setTenantSharing } from "@/app/actions/tenant/tenant";
import { setTenantOnDemand } from "@/app/actions/tenant/tenant-on-demand";
import { SectionRail, SectionSelect, type NavEntry } from "@/components/adapter/connection-form-nav";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { ON_DEMAND_DEFAULT } from "@/lib/tenant/sharing";
import { cn } from "@/lib/utils";
import { AllowancesPane, GeneralPane, OnDemandPane, PaneHead, SharingPane, type OnDemandDraft } from "./tenant-edit-panes";
import { TenantMembersPane } from "./tenant-members-pane";
import { NetworkPane } from "./tenant-network-pane";
import { allowancesPatch, countOf, sameNetwork, type TenantListRow } from "./tenant-words";

const log = logger.child({ component: "tenant-edit-dialog" });

/** The parts of Edit of a tenant, in the order of the list on the left. */
export type TenantSection = "general" | "members" | "sharing" | "allowances" | "network" | "on-demand";

const SECTIONS: (NavEntry & { id: TenantSection; description: string; customersOnly?: boolean })[] = [
    { id: "general", label: "General", icon: Building2, description: "The name of the tenant." },
    { id: "members", label: "Members", icon: Users, description: "Who works here with which group." },
    { id: "sharing", label: "Sharing", icon: Share2, description: "Whether it gives databases, destinations and channels to other tenants." },
    { id: "allowances", label: "What it may add", icon: Lock, description: "What the tenant adds itself, which the platform decides.", customersOnly: true },
    { id: "network", label: "Network", icon: Network, description: "Whether its connections reach the local network of the server DBackup runs on.", customersOnly: true },
    { id: "on-demand", label: "Backups on demand", icon: Zap, description: "How many backups a day it may start of every database given to it." },
];

interface TenantEditDialogProps {
    tenant: TenantListRow;
    /** The part it opens on, General when left out. */
    section?: TenantSection;
    viewerId: string;
    /** May change the tenant. Otherwise every part shows what it is and nothing saves. */
    canManage: boolean;
    viewerPlatformAdmin: boolean;
    onClose: () => void;
    /** After any change, a saved one or one that counts at once, so the list behind loads again. */
    onChanged: () => void;
}

/**
 * Edit of a tenant, every setting of it in one dialog: a list of the parts on the left, the part on
 * the right, like the form of a connection. The name, sharing, what it may add, the network and
 * backups on demand are saved together with Save changes, the members and Follow change at once.
 * The home tenant has no limits and reaches the network of its server, so it has no part for them.
 * It may still get databases of another tenant that shares, so it keeps Backups on demand.
 */
export function TenantEditDialog({ tenant, section = "general", viewerId, canManage, viewerPlatformAdmin, onClose, onChanged }: TenantEditDialogProps) {
    const sections = SECTIONS.filter((entry) => !(entry.customersOnly && tenant.isHome));
    const [active, setActive] = useState<TenantSection>(sections.some((entry) => entry.id === section) ? section : "general");
    const [name, setName] = useState(tenant.name);
    const [nameError, setNameError] = useState<string | null>(null);
    const [shares, setShares] = useState(tenant.sharesWithCustomers);
    const [allowances, setAllowances] = useState(tenant.allowances);
    const [network, setNetwork] = useState(tenant.network);
    const [onDemand, setOnDemand] = useState<OnDemandDraft>({ on: tenant.onDemand.perDay !== null, perDay: tenant.onDemand.perDay ?? ON_DEMAND_DEFAULT });
    const [pending, setPending] = useState(false);
    const readOnly = !canManage;
    const tone = readOnly ? "neutral" : "edit";

    const trimmed = name.trim();
    const patch = allowancesPatch(tenant.allowances, allowances);
    const perDay = onDemand.on ? onDemand.perDay : null;
    const networkChanged = !tenant.isHome && !sameNetwork(tenant.network, network);
    const changes = [
        ...(trimmed !== tenant.name ? ["the name"] : []),
        ...(shares !== tenant.sharesWithCustomers ? ["sharing"] : []),
        ...(Object.keys(patch).length > 0 ? ["what it may add"] : []),
        ...(networkChanged ? ["the network"] : []),
        ...(perDay !== tenant.onDemand.perDay ? ["backups on demand"] : []),
    ];

    /** Runs one save, says why it failed and opens its part. True once it went through. */
    const step = async (part: TenantSection, run: () => Promise<{ success: boolean; error?: string }>): Promise<boolean> => {
        const result = await run();
        if (result.success) return true;
        if (part === "general") setNameError(result.error ?? "The tenant could not be renamed.");
        else toast.error(result.error ?? "The tenant could not be saved.");
        setActive(part);
        return false;
    };

    const save = async () => {
        if (readOnly || changes.length === 0) return onClose();
        if (!trimmed) {
            setNameError("Give the tenant a name.");
            setActive("general");
            return;
        }
        setPending(true);
        try {
            const done = (trimmed === tenant.name || await step("general", () => renameTenant(tenant.id, trimmed)))
                && (shares === tenant.sharesWithCustomers || await step("sharing", () => setTenantSharing(tenant.id, shares)))
                && (Object.keys(patch).length === 0 || await step("allowances", () => setTenantAllowances(tenant.id, patch)))
                && (!networkChanged || await step("network", () => setTenantNetwork(tenant.id, network)))
                && (perDay === tenant.onDemand.perDay || await step("on-demand", () => setTenantOnDemand(tenant.id, perDay)));
            // What went through before a refusal shows once the list loads again.
            onChanged();
            if (!done) return;
            toast.success(`${trimmed} saved`);
            onClose();
        } catch (error: unknown) {
            log.warn("Saving a tenant failed", { tenantId: tenant.id }, wrapError(error));
            toast.error("The tenant could not be saved.");
        } finally {
            setPending(false);
        }
    };

    const disabled = readOnly || pending;
    const pane = (id: TenantSection) => {
        switch (id) {
            case "general":
                return <GeneralPane value={name} onChange={(next) => { setName(next); setNameError(null); }} error={nameError} disabled={disabled} />;
            case "members":
                return <TenantMembersPane tenant={{ id: tenant.id, name: tenant.name }} viewerId={viewerId} canManage={canManage} viewerPlatformAdmin={viewerPlatformAdmin} onChanged={onChanged} />;
            case "sharing":
                return <SharingPane tenant={tenant} value={shares} onChange={setShares} disabled={disabled} />;
            case "allowances":
                return <AllowancesPane tenant={tenant} value={allowances} onChange={setAllowances} disabled={disabled} />;
            case "network":
                return <NetworkPane tenant={tenant} value={network} onChange={setNetwork} disabled={disabled} />;
            case "on-demand":
                return <OnDemandPane tenant={tenant} value={onDemand} onChange={setOnDemand} disabled={disabled} canManage={canManage} onChanged={onChanged} />;
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
            <DialogContent tone={tone} showCloseButton={false} className={cn(DIALOG_SURFACE, "h-[95dvh] sm:h-auto sm:max-w-4xl")}>
                <DialogHead tone={tone} icon={readOnly ? Eye : Pencil}>
                    <DialogTitle className="truncate text-base">{readOnly ? tenant.name : `Edit ${tenant.name}`}</DialogTitle>
                    <DialogDescription className={cn(dialogNoteClass(tone), "truncate")}>
                        {[tenant.isHome ? "Home" : null, tenant.sharesWithCustomers ? "Shares with customers" : null, countOf(tenant.members, "member"), countOf(tenant.connections, "connection"), countOf(tenant.jobs, "job")].filter(Boolean).join(" · ")}
                    </DialogDescription>
                </DialogHead>

                <Tabs
                    orientation="vertical"
                    value={active}
                    onValueChange={(value) => setActive(value as TenantSection)}
                    className="min-h-0 flex-1 gap-0 md:h-[min(34rem,calc(95dvh-9.5rem))] md:flex-none md:flex-row"
                >
                    <SectionSelect sections={sections} statuses={{}} value={active} onValueChange={(value) => setActive(value as TenantSection)} />
                    <SectionRail sections={sections} statuses={{}} />
                    <ScrollArea className="min-h-0 min-w-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-15rem)] md:h-full md:*:data-[slot=scroll-area-viewport]:max-h-none">
                        {sections.map((entry) => (
                            <TabsContent key={entry.id} value={entry.id} forceMount className="space-y-5 p-5 data-[state=inactive]:hidden">
                                <PaneHead title={entry.label}>{entry.description}</PaneHead>
                                {pane(entry.id)}
                            </TabsContent>
                        ))}
                    </ScrollArea>
                </Tabs>

                <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                    <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground">
                        {readOnly ? "Read only" : changes.length > 0 ? `Changed: ${changes.join(", ")}` : "Members and Follow count at once"}
                    </span>
                    {readOnly || changes.length === 0 ? (
                        <Button type="button" variant="outline" onClick={onClose}>Close</Button>
                    ) : (
                        <>
                            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
                            <Button type="button" onClick={() => void save()} disabled={pending}>
                                {pending && <Loader2 className="animate-spin" />}
                                Save changes
                            </Button>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
