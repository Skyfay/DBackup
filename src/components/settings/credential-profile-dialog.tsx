"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Eye, EyeOff, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { CREDENTIAL_TYPES, type CredentialType } from "@/lib/core/credentials";
import { CredentialField } from "./credential-field";
import { SshPublicKeyPanel } from "./ssh-public-key-panel";
import { SshKeyFields } from "./ssh-key-fields";
import { buildSshPayload, hasSshPayload } from "./ssh-key-payload";

const TYPE_LABELS: Record<CredentialType, string> = {
    USERNAME_PASSWORD: "Username & Password",
    SSH_KEY: "SSH Key",
    ACCESS_KEY: "Access Key (S3 / API)",
    TOKEN: "Token",
    SMTP: "SMTP",
    WEBHOOK: "Webhook URL",
    OAUTH: "OAuth (Client Secret)",
};

const TYPE_DESCRIPTIONS: Record<CredentialType, string> = {
    USERNAME_PASSWORD: "Database / FTP / SMB user + password.",
    SSH_KEY: "SSH credentials (password, private key, or agent).",
    ACCESS_KEY: "S3-style access key + secret key pair.",
    TOKEN: "Bearer token (Gotify, ntfy, Telegram bot, Twilio).",
    SMTP: "SMTP user + password for email notifications.",
    WEBHOOK: "Webhook URL (Discord, Slack, Teams, generic webhook) + optional auth header.",
    OAUTH: "OAuth app (Google Drive, Dropbox, OneDrive): client ID + secret. The refresh token is added automatically after authorization.",
};

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
    /** Pre-selects a type (used by adapter form's inline create flow). */
    forcedType?: CredentialType;
    onSaved: (profile: CredentialProfileSummary) => void;
}

type FormState = Record<string, string | undefined>;

const DEFAULTS: Record<CredentialType, FormState> = {
    USERNAME_PASSWORD: { username: "", password: "" },
    SSH_KEY: {
        username: "",
        authType: "password",
        password: "",
        privateKey: "",
        passphrase: "",
        keySource: "paste",
        keyType: "ed25519",
        keyComment: "",
    },
    ACCESS_KEY: { accessKeyId: "", secretAccessKey: "" },
    TOKEN: { token: "" },
    SMTP: { user: "", password: "" },
    WEBHOOK: { url: "", authHeader: "" },
    OAUTH: { clientId: "", clientSecret: "" },
};

export function CredentialProfileDialog({
    open,
    onOpenChange,
    editProfile,
    forcedType,
    onSaved,
}: Props) {
    const isEdit = !!editProfile;
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [type, setType] = useState<CredentialType>(forcedType ?? "USERNAME_PASSWORD");
    const [data, setData] = useState<FormState>(DEFAULTS.USERNAME_PASSWORD);
    const [showSecrets, setShowSecrets] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    // Set once a save generated a keypair. The dialog then shows the public key instead of
    // the form, because this is the only moment the user is told which key to install.
    const [generated, setGenerated] = useState<CredentialProfileSummary | null>(null);

    // Reset / hydrate when dialog opens
    useEffect(() => {
        if (!open) return;
        setGenerated(null);
        if (editProfile) {
            setName(editProfile.name);
            setDescription(editProfile.description ?? "");
            setType(editProfile.type);
            setData(DEFAULTS[editProfile.type]);
            // Note: existing data is intentionally NOT prefilled. Editing data
            // requires the user to re-enter it (mirrors security-conscious UX).
        } else {
            setName("");
            setDescription("");
            const initialType = forcedType ?? "USERNAME_PASSWORD";
            setType(initialType);
            setData(DEFAULTS[initialType]);
        }
        setShowSecrets(false);
    }, [open, editProfile, forcedType]);

    const onTypeChange = (next: CredentialType) => {
        setType(next);
        setData(DEFAULTS[next]);
    };

    /** Suggested key comment, so a key is still identifiable in `authorized_keys` later. */
    const defaultComment = `dbackup@${
        name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dbackup"
    }`;

    const isGenerating =
        type === "SSH_KEY" && data.authType === "privateKey" && data.keySource === "generate";

    const submit = async () => {
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
                <DialogContent className="sm:max-w-xl max-h-[90vh] p-0">
                    <div className="px-6 pt-6 pb-4 shrink-0">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <KeyRound className="h-5 w-5" />
                                Keypair generated
                            </DialogTitle>
                            <DialogDescription>
                                The private key is stored encrypted in the vault and is not shown
                                again. Install the public key on the host before using this
                                profile.
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    {/* An RSA public key runs to a dozen wrapped lines, so this scrolls. Same
                        measured budgets as the form above, where the reasoning lives. */}
                    <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(90vh-20rem)] sm:*:data-[slot=scroll-area-viewport]:max-h-[calc(90vh-16rem)]">
                        <div className="px-6 pb-4">
                            <SshPublicKeyPanel
                                publicKey={generated.publicKey!}
                                fingerprint={generated.fingerprint}
                                fileName={generated.name}
                            />
                        </div>
                    </ScrollArea>

                    <div className="px-6 pt-2 pb-6 shrink-0">
                        <DialogFooter>
                            <Button onClick={() => handleOpenChange(false)}>Done</Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone={isEdit ? "edit" : "create"} className="sm:max-w-xl max-h-[90vh] p-0">
                <div className="px-6 pt-6 pb-4 shrink-0">
                    <DialogHeader>
                        <DialogTitle>
                            {isEdit ? "Edit Credential Profile" : "New Credential Profile"}
                        </DialogTitle>
                        <DialogDescription>
                            {isEdit
                                ? "Update name, description, or rotate the secret payload."
                                : "Create a reusable credential that adapters can reference instead of inline secrets."}
                        </DialogDescription>
                    </DialogHeader>
                </div>

                {/* Two measured budgets, the same way the encryption vault does it. Above sm:
                    the chrome is header 6.6rem (pt-6, an 18px title, a two line description,
                    pb-4) + footer 4.25rem (pt-2, a h-9 button, pb-6) + the two gap-4 that
                    DialogContent puts between its children, so 13rem with 3rem of slack for a
                    third description line. Below sm: DialogFooter stacks its buttons and the
                    description wraps further, which is worth another 4rem.

                    flex-1 min-h-0 is not an option here: DialogContent is capped with max-h
                    rather than sized with h, so its height stays indefinite, the viewport's
                    height:100% never resolves, and the content spills over the footer. Every
                    dialog in this repo that scrolls with flex-1 sets a definite h-[..vh]. */}
                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(90vh-20rem)] sm:*:data-[slot=scroll-area-viewport]:max-h-[calc(90vh-16rem)]">
                <div className="space-y-4 px-6 pb-4">
                    <div className="space-y-2">
                        <Label htmlFor="cred-name">Name</Label>
                        <Input
                            id="cred-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Production MySQL Read-Only"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="cred-desc">Description (optional)</Label>
                        <Textarea
                            id="cred-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                            className="resize-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                            value={type}
                            onValueChange={(v) => onTypeChange(v as CredentialType)}
                            disabled={isEdit || !!forcedType}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CREDENTIAL_TYPES.map((t) => (
                                    <SelectItem key={t} value={t}>
                                        {TYPE_LABELS[t]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            {TYPE_DESCRIPTIONS[type]}
                            {isEdit && " (Type cannot be changed after creation.)"}
                        </p>
                    </div>

                    <div className="space-y-3 rounded-md border p-4 bg-muted/30">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                                {isEdit ? "Rotate secret payload (optional)" : "Secret payload"}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowSecrets((s) => !s)}
                            >
                                {showSecrets ? (
                                    <EyeOff className="h-4 w-4" />
                                ) : (
                                    <Eye className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                        <TypeFields
                            type={type}
                            data={data}
                            setData={setData}
                            showSecrets={showSecrets}
                            defaultComment={defaultComment}
                        />
                        {isEdit && (
                            <p className="text-xs text-muted-foreground">
                                Leave fields blank to keep the existing secret unchanged.
                            </p>
                        )}
                    </div>
                </div>
                </ScrollArea>

                <div className="px-6 pt-2 pb-6 shrink-0">
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button onClick={submit} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isGenerating
                                ? "Generate and save"
                                : isEdit
                                  ? "Save changes"
                                  : "Create profile"}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// --------------------------------------------------------------------------
// Type-specific field renderer
// --------------------------------------------------------------------------

function TypeFields({
    type,
    data,
    setData,
    showSecrets,
    defaultComment,
}: {
    type: CredentialType;
    data: FormState;
    setData: (next: FormState) => void;
    showSecrets: boolean;
    defaultComment: string;
}) {
    const update = (key: string, value: string) => setData({ ...data, [key]: value });
    const secret = showSecrets ? "text" : "password";

    if (type === "USERNAME_PASSWORD") {
        return (
            <div className="space-y-3">
                <CredentialField label="Username" value={data.username ?? ""} onChange={(v) => update("username", v)} />
                <CredentialField label="Password" type={secret} value={data.password ?? ""} onChange={(v) => update("password", v)} />
            </div>
        );
    }

    if (type === "SSH_KEY") {
        return (
            <SshKeyFields
                data={data}
                update={update}
                showSecrets={showSecrets}
                defaultComment={defaultComment}
            />
        );
    }

    if (type === "ACCESS_KEY") {
        return (
            <div className="space-y-3">
                <CredentialField label="Access key ID" value={data.accessKeyId ?? ""} onChange={(v) => update("accessKeyId", v)} />
                <CredentialField label="Secret access key" type={secret} value={data.secretAccessKey ?? ""} onChange={(v) => update("secretAccessKey", v)} />
            </div>
        );
    }

    if (type === "TOKEN") {
        return (
            <CredentialField label="Token" type={secret} value={data.token ?? ""} onChange={(v) => update("token", v)} />
        );
    }

    if (type === "SMTP") {
        return (
            <div className="space-y-3">
                <CredentialField label="User" value={data.user ?? ""} onChange={(v) => update("user", v)} />
                <CredentialField label="Password" type={secret} value={data.password ?? ""} onChange={(v) => update("password", v)} />
            </div>
        );
    }

    if (type === "WEBHOOK") {
        return (
            <div className="space-y-3">
                <CredentialField label="Webhook URL" type={secret} value={data.url ?? ""} onChange={(v) => update("url", v)} />
                <CredentialField label="Auth header (optional)" type={secret} value={data.authHeader ?? ""} onChange={(v) => update("authHeader", v)} />
            </div>
        );
    }

    if (type === "OAUTH") {
        return (
            <div className="space-y-3">
                <CredentialField label="Client ID" value={data.clientId ?? ""} onChange={(v) => update("clientId", v)} />
                <CredentialField label="Client Secret" type={secret} value={data.clientSecret ?? ""} onChange={(v) => update("clientSecret", v)} />
            </div>
        );
    }

    return null;
}

// Strip empty optional fields and coerce to the right shape per type
function cleanData(
    type: CredentialType,
    raw: FormState,
    defaultComment: string
): Record<string, unknown> {
    // SSH_KEY carries form-only fields (which key source, which type to generate) that the
    // API must never see, so it builds its own payload.
    if (type === "SSH_KEY") return buildSshPayload(raw, defaultComment);

    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
        if (v !== undefined && v !== "") out[k] = v;
    }
    return out;
}

function hasAnyValue(type: CredentialType, raw: FormState): boolean {
    if (type === "SSH_KEY") return hasSshPayload(raw);
    return Object.values(raw).some((v) => v !== undefined && v !== "");
}
