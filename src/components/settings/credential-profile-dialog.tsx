"use client";

import { useEffect, useId, useState } from "react";
import { ChevronLeft, KeyRound, Loader2, Lock, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CredentialType } from "@/lib/core/credentials";
import { cn } from "@/lib/utils";
import { CredentialTypeList } from "./credential-type-list";
import { DEFAULTS, TypeFields, cleanData, hasAnyValue, type FormState } from "./credential-type-fields";
import { CREDENTIAL_TYPE_INFO } from "./credential-types";
import { SshPublicKeyPanel } from "./ssh-public-key-panel";

export interface CredentialProfileSummary {
    id: string;
    name: string;
    type: CredentialType;
    description: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
    /** Which sensitive fields are set (e.g. OAUTH `refreshToken`) - no values. */
    secretStatus?: Record<string, boolean>;
    /** SSH_KEY on private-key auth: the public half, which is not a secret. */
    publicKey?: string;
    fingerprint?: string;
    /** How many connections use it, from the list with `includeCounts=true`. */
    usageCount?: number;
    /** The adapters of those connections, each once. */
    usedBy?: string[];
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** When set, dialog opens in edit mode for the given profile. */
    editProfile?: CredentialProfileSummary | null;
    /** The kind a field asks for. The dialog then opens on the form for it, with no way to change it. */
    forcedType?: CredentialType;
    /** What the field calls it, like "login" or "SSH login", for the title and the button. */
    noun?: string;
    /** The kind of connection the field belongs to, like "MySQL", named in the head. */
    forName?: string;
    onSaved: (profile: CredentialProfileSummary) => void;
}

/** The body scrolls between the head and the buttons, whose height the viewport cap leaves out. */
const BODY_SCROLL = "*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)] [&>[data-slot=scroll-area-viewport]>div]:block!";

/**
 * Creates or edits a credential profile.
 *
 * From the Vault it starts with the list of kinds, like adding a connection starts with its
 * type. From a field that needs one, the kind is known, so it opens on the form right away and
 * names the profile like the field does. Editing keeps the kind and never shows the stored
 * secret: it is replaced only when a new one is typed in.
 */
export function CredentialProfileDialog({ open, onOpenChange, editProfile, forcedType, noun: fieldNoun, forName, onSaved }: Props) {
    const isEdit = !!editProfile;
    const [step, setStep] = useState<"type" | "form">("form");
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [type, setType] = useState<CredentialType>(forcedType ?? "USERNAME_PASSWORD");
    const [data, setData] = useState<FormState>(DEFAULTS.USERNAME_PASSWORD);
    const [isSaving, setIsSaving] = useState(false);
    // Set once a save generated a keypair. The dialog then shows the public key instead of
    // the form, because this is the only moment the user is told which key to install.
    const [generated, setGenerated] = useState<CredentialProfileSummary | null>(null);
    const nameId = useId();
    const descriptionId = useId();

    // Reset / hydrate when dialog opens
    useEffect(() => {
        if (!open) return;
        setGenerated(null);
        if (editProfile) {
            setName(editProfile.name);
            setDescription(editProfile.description ?? "");
            setType(editProfile.type);
            setData(DEFAULTS[editProfile.type]);
            setStep("form");
            // Note: existing data is intentionally NOT prefilled. Editing data
            // requires the user to re-enter it (mirrors security-conscious UX).
        } else {
            setName("");
            setDescription("");
            const initialType = forcedType ?? "USERNAME_PASSWORD";
            setType(initialType);
            setData(DEFAULTS[initialType]);
            // The Vault does not know the kind yet, a field does.
            setStep(forcedType ? "form" : "type");
        }
    }, [open, editProfile, forcedType]);

    const info = CREDENTIAL_TYPE_INFO[type];
    const noun = fieldNoun ?? info.noun;

    const pickType = (next: CredentialType) => {
        setType(next);
        setData(DEFAULTS[next]);
        setStep("form");
    };

    /** Suggested key comment, so a key is still identifiable in `authorized_keys` later. */
    const defaultComment = `dbackup@${
        name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dbackup"
    }`;

    const isGenerating =
        type === "SSH_KEY" && data.authType === "privateKey" && data.keySource === "generate";

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) {
            toast.error("Name is required.");
            return;
        }
        // Editing never prefills the payload, so an SSH username has to be re-entered along
        // with the key it belongs to. Saying so beats a generic validation error.
        if (isGenerating && !data.username?.trim()) {
            toast.error("Username is required to generate a keypair.");
            return;
        }

        setIsSaving(true);
        try {
            const payload = cleanData(type, data, defaultComment);
            const url = isEdit ? `/api/credentials/${editProfile!.id}` : "/api/credentials";
            const method = isEdit ? "PUT" : "POST";
            const body = isEdit
                ? {
                      name,
                      description: description || null,
                      // Only re-encrypt data if user actually entered values
                      ...(hasAnyValue(type, data) ? { data: payload } : {}),
                  }
                : { name, type, description: description || null, data: payload };

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = await res.json();

            if (!res.ok || !result.success) {
                toast.error(result.error || "Failed to save credential profile.");
                return;
            }
            toast.success(
                isEdit ? "Credential profile updated" : "Credential profile created"
            );

            const profile = result.data as CredentialProfileSummary;
            if (isGenerating && profile.publicKey) {
                // Hold the dialog open on the result view. `onSaved` fires once it closes.
                setGenerated(profile);
                return;
            }
            onSaved(profile);
            onOpenChange(false);
        } catch {
            toast.error("Network error while saving credential profile.");
        } finally {
            setIsSaving(false);
        }
    };

    /**
     * Closing the result view is what reports the save upwards, so the caller still refreshes
     * its list when the dialog is dismissed with Escape or the overlay instead of the button.
     */
    const handleOpenChange = (next: boolean) => {
        if (!next && generated) {
            const profile = generated;
            setGenerated(null);
            onSaved(profile);
        }
        onOpenChange(next);
    };

    if (generated) {
        return (
            <Dialog open={open} onOpenChange={handleOpenChange}>
                {/* No tone on the dialog: the green of the head reports, it never colors the button. */}
                <DialogContent showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                    <DialogHead tone="success" icon={KeyRound} className="px-5 py-4">
                        <DialogTitle className="text-base">Keypair generated</DialogTitle>
                        <DialogDescription className={dialogNoteClass("success")}>
                            Install the public key on the host before this profile is used.
                        </DialogDescription>
                    </DialogHead>
                    {/* An RSA public key runs to a dozen wrapped lines, so this scrolls. */}
                    <ScrollArea className={BODY_SCROLL}>
                        <div className="space-y-3 p-5">
                            <p className="text-sm text-muted-foreground">
                                The private key is stored encrypted in the Vault and is not shown again.
                            </p>
                            <SshPublicKeyPanel publicKey={generated.publicKey!} fingerprint={generated.fingerprint} fileName={generated.name} />
                        </div>
                    </ScrollArea>
                    <div className={cn(DIALOG_FOOTER, "flex justify-end")}>
                        <Button onClick={() => handleOpenChange(false)}>Done</Button>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    const fromVault = !isEdit && !forcedType;
    const note = isEdit
        ? `${editProfile!.name} · ${info.hint}`
        : fromVault
          ? `${info.hint} · Step 2 of 2`
          : [info.hint, forName && `for ${forName}`].filter(Boolean).join(" · ");

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone={isEdit ? "edit" : "create"} showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                {step === "type" ? (
                    <CredentialTypeList onPick={pickType} />
                ) : (
                    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
                        <DialogHead
                            tone={isEdit ? "edit" : "create"}
                            icon={isEdit ? Pencil : info.icon}
                            className="px-5 py-4"
                            action={
                                fromVault && (
                                    <Button type="button" variant="outline" size="sm" onClick={() => setStep("type")}>
                                        <ChevronLeft />
                                        Change type
                                    </Button>
                                )
                            }
                        >
                            <DialogTitle className="text-base">{isEdit ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
                            <DialogDescription className={cn(dialogNoteClass(isEdit ? "edit" : "create"), "truncate")}>{note}</DialogDescription>
                        </DialogHead>

                        <ScrollArea className={cn("min-h-0 flex-1", BODY_SCROLL)}>
                            <div className="space-y-5 p-5">
                                <div className="space-y-2">
                                    <Label htmlFor={nameId}>Name</Label>
                                    <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. MySQL backup user" autoComplete="off" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor={descriptionId}>Description</Label>
                                    <Input
                                        id={descriptionId}
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        placeholder="Optional, like what it may do"
                                        autoComplete="off"
                                    />
                                </div>

                                <div className="flex items-start gap-3 pt-1">
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">
                                        <Lock className="size-3.5 text-muted-foreground" />
                                    </span>
                                    <div className="grid gap-0.5">
                                        <p className="text-sm font-semibold">{isEdit ? "New secret" : "Secret"}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {isEdit
                                                ? "Leave it empty to keep the stored one."
                                                : "Stored encrypted in the Vault. Only people allowed to reveal it can see it again."}
                                        </p>
                                    </div>
                                </div>
                                <TypeFields type={type} data={data} setData={setData} defaultComment={defaultComment} />
                            </div>
                        </ScrollArea>

                        <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                            <DialogClose asChild>
                                <Button type="button" variant="ghost">Cancel</Button>
                            </DialogClose>
                            <Button type="submit" disabled={isSaving}>
                                {isSaving && <Loader2 className="animate-spin" />}
                                {isGenerating ? "Generate and save" : isEdit ? "Save changes" : `Create ${noun}`}
                            </Button>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
