"use client";

import { useState } from "react";
import { Loader2, Mail, Pencil, Send } from "lucide-react";
import { toast } from "sonner";
import { setChannelRecipients, testChannelRecipients } from "@/app/actions/tenant/connection-share";
import { useCan } from "@/components/permissions/permissions-context";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/ui/tag-input";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { cn, formatBytes } from "@/lib/utils";
import type { ConnectionKind } from "./connection-columns";
import { FactList, Section } from "./connection-details-sections";
import type { AdapterConfig } from "./types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 20;

/**
 * The part of the details of a connection another tenant shares with this one: who shares it, what
 * this tenant does with it and, for an email channel that lets it, its own recipients. Its address,
 * login and settings stay with the tenant that shares it.
 */
export function ProvidedSection({ config, kind, onChanged }: { config: AdapterConfig; kind: ConnectionKind; onChanged?: () => void }) {
    const terms = config.provided;
    const canWrite = useCan(PERMISSIONS.NOTIFICATIONS.WRITE);
    const [editing, setEditing] = useState(false);
    const [testing, setTesting] = useState(false);
    if (!terms) return null;
    const destination = kind === "destination";
    const recipients = terms.recipients ?? [];
    const stored = config.overview?.stored;

    const facts: { label: string; value: React.ReactNode }[] = [
        { label: "Provided by", value: terms.providerName },
        { label: destination ? "Address" : "Server and sender", value: `Kept by ${terms.providerName}` },
        ...(destination
            ? [
                  { label: "Your backups", value: stored ? `${stored.count.toLocaleString()} backups, ${formatBytes(stored.size, 1)}` : "None yet" },
                  { label: "Encryption", value: terms.encryptedOnly ? "Required, with a key of your Vault" : "Your choice" },
              ]
            : terms.ownRecipients
                ? [{ label: "Your recipients", value: recipients.length > 0 ? recipients.join(", ") : <span className="text-warning">None yet, nothing goes out</span> }]
                : [{ label: "Recipients", value: `Set by ${terms.providerName}` }]),
    ];

    const test = async () => {
        setTesting(true);
        const result = await testChannelRecipients(config.id).catch(() => null);
        setTesting(false);
        if (result?.success) toast.success(`A test went to ${result.data.recipients.join(", ")}`);
        else toast.error(result && !result.success ? result.error : "The test did not go out.");
    };

    return (
        <Section
            title={`Provided by ${terms.providerName}`}
            aside={terms.ownRecipients && canWrite ? (
                <span className="inline-flex gap-2">
                    <Button variant="outline" size="sm" onClick={test} disabled={testing || recipients.length === 0}>
                        {testing ? <Loader2 className="animate-spin" /> : <Send />}
                        Send a test
                    </Button>
                    <Button variant="outline" size="sm" tone="edit" onClick={() => setEditing(true)}>
                        <Pencil />
                        Recipients
                    </Button>
                </span>
            ) : undefined}
        >
            <FactList facts={facts} />
            <p className="text-xs text-muted-foreground">
                {destination
                    ? `Use it in your jobs. Your backups go to a folder of your own on it, which only this tenant sees. ${terms.providerName} changes it, and when it stops sharing it, your backups there go with it.`
                    : `Name it in your notification templates. ${terms.providerName} keeps the server and the login, and changes them.`}
            </p>
            {editing && <RecipientsDialog config={config} initial={recipients} onOpenChange={setEditing} onSaved={onChanged} />}
        </Section>
    );
}

/** The recipients this tenant names for an email channel another tenant shares with it. */
function RecipientsDialog({ config, initial, onOpenChange, onSaved }: { config: AdapterConfig; initial: string[]; onOpenChange: (open: boolean) => void; onSaved?: () => void }) {
    const [recipients, setRecipients] = useState(initial);
    const [saving, setSaving] = useState(false);
    const save = async () => {
        setSaving(true);
        const result = await setChannelRecipients(config.id, recipients).catch(() => null);
        setSaving(false);
        if (!result || !result.success) {
            toast.error(result && !result.success ? result.error : "The recipients could not be saved.");
            return;
        }
        toast.success(`Saved the recipients of ${config.name}`);
        onOpenChange(false);
        onSaved?.();
    };
    const unchanged = recipients.length === initial.length && recipients.every((address, index) => address === initial[index]);
    return (
        <Dialog open onOpenChange={(open) => !saving && onOpenChange(open)}>
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                <DialogHead tone="edit" icon={Mail}>
                    <DialogTitle className="text-base">Recipients of {config.name}</DialogTitle>
                    <DialogDescription className={dialogNoteClass("edit")}>For every job and template of this tenant that names it</DialogDescription>
                </DialogHead>
                <div className="space-y-2 p-5">
                    <Label htmlFor="channel-recipients">To</Label>
                    <TagInput
                        id="channel-recipients"
                        value={recipients}
                        onChange={(next) => setRecipients(next.slice(0, MAX_RECIPIENTS))}
                        placeholder="recipient@example.com"
                        validate={(address) => EMAIL.test(address)}
                    />
                    <p className="text-xs text-muted-foreground">
                        Up to {MAX_RECIPIENTS} addresses. The mail goes out through the server and from the sender of {config.provided?.providerName ?? "the tenant that shares it"}.
                    </p>
                </div>
                <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
                    <Button onClick={save} disabled={saving || unchanged}>
                        {saving && <Loader2 className="animate-spin" />}
                        Save changes
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
