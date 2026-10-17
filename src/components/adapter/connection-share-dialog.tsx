"use client";

import { useMemo, useState } from "react";
import { Loader2, Share2, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { deleteSharedBackups, previewShareLoss, saveConnectionShare, stopSharingWith } from "@/app/actions/tenant/connection-share";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog, DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes, cn } from "@/lib/utils";
import type { ConnectionShareView, ShareSettings, ShareTenantUse } from "@/services/sharing/connection-shares";
import { ChoiceCards } from "./connection-mode-choice";
import { SwitchList, SwitchRow } from "./setting-switches";

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** What a tenant loses with a connection, in one line. */
function lossLine(use: ShareTenantUse, destination: boolean): string {
    if (!destination) return `${plural(use.templates, "template", "templates")} and ${plural(use.jobs, "job", "jobs")} lose the channel.`;
    const backups = use.backups === null ? "Its backups here are deleted" : `Its ${plural(use.backups, "backup", "backups")} here${use.size ? `, ${formatBytes(use.size, 1)},` : ""} are deleted`;
    return `${backups}, and ${plural(use.jobs, "job", "jobs")} stop writing here.`;
}

/** The tenants that lose a connection with what each loses, for a confirmation. */
function LossList({ losing, destination }: { losing: ShareTenantUse[]; destination: boolean }) {
    return (
        <ul className="divide-y rounded-lg border">
            {losing.map((use) => (
                <li key={use.tenantId} className="px-3 py-2.5">
                    <p className="text-sm font-medium">{use.name}</p>
                    <p className="text-xs text-muted-foreground">{lossLine(use, destination)}</p>
                </li>
            ))}
        </ul>
    );
}

/**
 * Who gets a destination or a channel, and on what terms. Saving it for fewer tenants asks first
 * and says what each of them loses, on a destination its backups there.
 */
export function ConnectionShareDialog({ view, onOpenChange, onSaved }: { view: ConnectionShareView; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
    const destination = view.kind === "destination";
    const [settings, setSettings] = useState<ShareSettings>(() => ({
        ...view.settings,
        // A connection nobody gets yet starts with every tenant ticked off and the cards on Picked.
        tenantIds: view.settings.allTenants ? view.candidates.map((tenant) => tenant.id) : view.settings.tenantIds,
    }));
    const [saving, setSaving] = useState(false);
    const [losing, setLosing] = useState<ShareTenantUse[] | null>(null);
    const picked = useMemo(() => new Set(settings.tenantIds), [settings.tenantIds]);
    const count = settings.allTenants ? view.candidates.length : settings.tenantIds.length;

    const toggle = (id: string, on: boolean) =>
        setSettings((current) => ({ ...current, tenantIds: on ? [...current.tenantIds, id] : current.tenantIds.filter((entry) => entry !== id) }));

    const save = async (confirmed: boolean) => {
        setSaving(true);
        try {
            const result = await saveConnectionShare(view.configId, settings, confirmed);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(count > 0 ? `${view.name} is shared with ${plural(count, "tenant", "tenants")}` : `${view.name} is no longer shared`);
            onOpenChange(false);
            onSaved();
        } finally {
            setSaving(false);
        }
    };

    const submit = async () => {
        setSaving(true);
        const preview = await previewShareLoss(view.configId, { allTenants: settings.allTenants, tenantIds: settings.tenantIds }).catch(() => null);
        setSaving(false);
        if (!preview || !preview.success) {
            toast.error(preview && !preview.success ? preview.error : "The change could not be checked.");
            return;
        }
        if (preview.data.length > 0) setLosing(preview.data);
        else await save(false);
    };

    return (
        <>
            <Dialog open onOpenChange={(open) => !saving && onOpenChange(open)}>
                <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                    <DialogHead tone="edit" icon={Share2}>
                        <DialogTitle className="text-base">Share {view.name}</DialogTitle>
                        <DialogDescription className={dialogNoteClass("edit")}>Who gets it and on what terms</DialogDescription>
                    </DialogHead>
                    <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]">
                        <div className="space-y-5 p-5">
                            <div className="space-y-2.5">
                                <Label>Who sees it</Label>
                                <ChoiceCards
                                    value={settings.allTenants ? "all" : "picked"}
                                    onValueChange={(value) => setSettings((current) => ({ ...current, allTenants: value === "all" }))}
                                    options={[
                                        { value: "all", title: "All tenants", description: `The ${view.candidates.length} of today and every new one.` },
                                        { value: "picked", title: "Picked tenants", description: "Only the tenants ticked below." },
                                    ]}
                                />
                                {!settings.allTenants && (
                                    <ul className="divide-y rounded-lg border">
                                        {view.candidates.map((tenant) => {
                                            const use = view.uses.find((entry) => entry.tenantId === tenant.id);
                                            return (
                                                <li key={tenant.id}>
                                                    <Label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 font-normal">
                                                        <Checkbox checked={picked.has(tenant.id)} onCheckedChange={(on) => toggle(tenant.id, on === true)} />
                                                        <span className="min-w-0 flex-1 truncate text-sm">{tenant.name}</span>
                                                        <span className="shrink-0 text-xs text-muted-foreground">
                                                            {use ? (destination ? `${plural(use.jobs, "job", "jobs")} write here` : `${plural(use.templates, "template", "templates")}`) : "does not use it"}
                                                        </span>
                                                    </Label>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>

                            {destination && (
                                <div className="space-y-2.5">
                                    <Label>What they may put on it</Label>
                                    <SwitchList>
                                        <SwitchRow
                                            title="Only encrypted backups"
                                            description="A job of a tenant writes to it only with a key of its own Vault. Off, each tenant decides."
                                            checked={settings.encryptedOnly}
                                            onCheckedChange={(on) => setSettings((current) => ({ ...current, encryptedOnly: on }))}
                                        />
                                    </SwitchList>
                                    <p className="text-xs text-muted-foreground">
                                        A tenant writes to tenants/ and its id on it, which only that tenant sees. The backups of this tenant stay where they are.
                                    </p>
                                </div>
                            )}

                            {view.kind === "channel" && (view.email ? (
                                <div className="space-y-2.5">
                                    <Label>Who gets the mail</Label>
                                    <ChoiceCards
                                        value={settings.ownRecipients ? "own" : "fixed"}
                                        onValueChange={(value) => setSettings((current) => ({ ...current, ownRecipients: value === "own" }))}
                                        options={[
                                            { value: "own", title: "The recipients each tenant picks", description: "The server, the login and the sender stay with this tenant. A tenant names its own addresses." },
                                            { value: "fixed", title: "The recipients set here", description: "The mail comes to this tenant, about the runs of the jobs of a tenant that names it." },
                                        ]}
                                    />
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground">A chat or a webhook sends where it is set here, its address is the recipient.</p>
                            ))}
                        </div>
                    </ScrollArea>
                    <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={submit} disabled={saving || (!settings.allTenants && settings.tenantIds.length === 0 && view.uses.length === 0)}>
                            {saving && <Loader2 className="animate-spin" />}
                            {count > 0 ? `Share with ${plural(count, "tenant", "tenants")}` : "Stop sharing"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
            {losing && (
                <ConfirmDialog
                    open
                    onOpenChange={(open) => !open && setLosing(null)}
                    title={`${plural(losing.length, "tenant loses", "tenants lose")} ${view.name}`}
                    note={destination ? "Their backups here are deleted" : "Their templates lose the channel"}
                    icon={Unlink}
                    destructive={destination}
                    tone={destination ? undefined : "warning"}
                    confirmLabel={destination ? "Save and delete their backups" : "Save"}
                    isPending={saving}
                    onConfirm={() => save(true)}
                >
                    <LossList losing={losing} destination={destination} />
                </ConfirmDialog>
            )}
        </>
    );
}

/** Stops sharing with one tenant. On a destination its backups there go too, which its name confirms. */
export function StopSharingDialog({ view, use, onOpenChange, onDone }: { view: ConnectionShareView; use: ShareTenantUse; onOpenChange: (open: boolean) => void; onDone: () => void }) {
    const destination = view.kind === "destination";
    const [typed, setTyped] = useState("");
    const [pending, setPending] = useState(false);
    const stop = async () => {
        setPending(true);
        const result = await stopSharingWith(view.configId, use.tenantId, true).catch(() => null);
        setPending(false);
        if (!result || !result.success) {
            toast.error(result && !result.success ? result.error : "The sharing could not be changed.");
            return;
        }
        toast.success(`${view.name} is no longer shared with ${use.name}`);
        onOpenChange(false);
        onDone();
    };
    return (
        <ConfirmDialog
            open
            onOpenChange={onOpenChange}
            title={`Stop sharing ${view.name} with ${use.name}`}
            note={destination ? "Its backups here go with it" : "Its templates lose the channel"}
            icon={Unlink}
            destructive={destination}
            tone={destination ? undefined : "warning"}
            confirmLabel={destination ? `Stop sharing and delete ${use.backups === null ? "its backups" : plural(use.backups, "backup", "backups")}` : "Stop sharing"}
            isPending={pending}
            disabled={destination && typed.trim() !== use.name}
            onConfirm={stop}
        >
            <LossList losing={[use]} destination={destination} />
            <p className="text-sm text-muted-foreground">
                {destination
                    ? `${use.name} sees a note about it on its Connections page for two weeks, the failed runs in its History and an entry in its audit log.`
                    : `${use.name} sees a note about it on its Connections page for two weeks and an entry in its audit log.`}
                {view.settings.allTenants && " The other tenants keep it, a tenant added later no longer gets it."}
            </p>
            {destination && (
                <div className="space-y-1.5">
                    <Label htmlFor="stop-sharing-name">Type {use.name} to confirm</Label>
                    <Input id="stop-sharing-name" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
                </div>
            )}
        </ConfirmDialog>
    );
}

/** Deletes the backups of one tenant on a shared destination. Its jobs go on writing to it. */
export function DeleteTenantBackupsDialog({ view, use, onOpenChange, onDone }: { view: ConnectionShareView; use: ShareTenantUse; onOpenChange: (open: boolean) => void; onDone: () => void }) {
    const [pending, setPending] = useState(false);
    const remove = async () => {
        setPending(true);
        const result = await deleteSharedBackups(view.configId, use.tenantId).catch(() => null);
        setPending(false);
        if (!result || !result.success) {
            toast.error(result && !result.success ? result.error : "The backups could not be deleted.");
            return;
        }
        toast.success(`Deleted ${plural(result.data.backups, "backup", "backups")} of ${use.name}`);
        onOpenChange(false);
        onDone();
    };
    return (
        <ConfirmDialog
            open
            onOpenChange={onOpenChange}
            title={`Delete the backups of ${use.name} on ${view.name}`}
            note="Cannot be undone"
            icon={Trash2}
            destructive
            confirmLabel={use.backups === null ? "Delete its backups" : `Delete ${plural(use.backups, "backup", "backups")}`}
            isPending={pending}
            onConfirm={remove}
            description={`Every backup of ${use.name} on this destination is deleted${use.size ? `, ${formatBytes(use.size, 1)}` : ""}. Its jobs go on writing new ones, and it can no longer download or restore the old ones.`}
        />
    );
}
