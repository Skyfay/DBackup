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
import { Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { CREDENTIAL_TYPES, type CredentialType } from "@/lib/core/credentials";

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
    SSH_KEY: { username: "", authType: "password", password: "", privateKey: "", passphrase: "" },
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

    // Reset / hydrate when dialog opens
    useEffect(() => {
        if (!open) return;
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

    const submit = async () => {
        if (!name.trim()) {
            toast.error("Name is required.");
            return;
        }

        setIsSaving(true);
        try {
            const url = isEdit ? `/api/credentials/${editProfile!.id}` : "/api/credentials";
            const method = isEdit ? "PUT" : "POST";
            const body = isEdit
                ? {
                      name,
                      description: description || null,
                      // Only re-encrypt data if user actually entered values
                      ...(hasAnyValue(data) ? { data: cleanData(type, data) } : {}),
                  }
                : { name, type, description: description || null, data: cleanData(type, data) };

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
            onSaved(result.data as CredentialProfileSummary);
            onOpenChange(false);
        } catch {
            toast.error("Network error while saving credential profile.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl max-h-[90vh] p-0">
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

                <ScrollArea className="max-h-[calc(90vh-10rem)]">
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
                        />
                        {isEdit && (
                            <p className="text-xs text-muted-foreground">
                                Leave fields blank to keep the existing secret unchanged.
                            </p>
                        )}
                    </div>
                </div>
                </ScrollArea>

                <div className="px-6 pt-2 pb-6">
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button onClick={submit} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isEdit ? "Save changes" : "Create profile"}
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
}: {
    type: CredentialType;
    data: FormState;
    setData: (next: FormState) => void;
    showSecrets: boolean;
}) {
    const update = (key: string, value: string) => setData({ ...data, [key]: value });
    const secret = showSecrets ? "text" : "password";

    if (type === "USERNAME_PASSWORD") {
        return (
            <div className="space-y-3">
                <Field label="Username" value={data.username ?? ""} onChange={(v) => update("username", v)} />
                <Field label="Password" type={secret} value={data.password ?? ""} onChange={(v) => update("password", v)} />
            </div>
        );
    }

    if (type === "SSH_KEY") {
        return (
            <div className="space-y-3">
                <Field label="Username" value={data.username ?? ""} onChange={(v) => update("username", v)} />
                <div className="space-y-1.5">
                    <Label className="text-xs">Auth method</Label>
                    <Select
                        value={data.authType ?? "password"}
                        onValueChange={(v) => update("authType", v)}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="password">Password</SelectItem>
                            <SelectItem value="privateKey">Private Key</SelectItem>
                            <SelectItem value="agent">SSH Agent</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {data.authType === "password" && (
                    <Field label="Password" type={secret} value={data.password ?? ""} onChange={(v) => update("password", v)} />
                )}
                {data.authType === "privateKey" && (
                    <>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Private key (PEM)</Label>
                            <Textarea
                                value={data.privateKey ?? ""}
                                onChange={(e) => update("privateKey", e.target.value)}
                                className="font-mono text-xs resize-y h-16 field-sizing-fixed"
                                placeholder="-----BEGIN RSA PRIVATE KEY-----"
                                style={!showSecrets ? { WebkitTextSecurity: "disc", textSecurity: "disc" } as React.CSSProperties : undefined}
                            />
                            {(data.privateKey ?? "").includes("BEGIN ENCRYPTED PRIVATE KEY") && (
                                <p className="text-xs text-amber-500">
                                    PKCS#8 encrypted key detected. Make sure to fill in the passphrase field below.
                                </p>
                            )}
                        </div>
                        <Field label="Key passphrase (optional)" type={secret} value={data.passphrase ?? ""} onChange={(v) => update("passphrase", v)} />
                    </>
                )}
            </div>
        );
    }

    if (type === "ACCESS_KEY") {
        return (
            <div className="space-y-3">
                <Field label="Access key ID" value={data.accessKeyId ?? ""} onChange={(v) => update("accessKeyId", v)} />
                <Field label="Secret access key" type={secret} value={data.secretAccessKey ?? ""} onChange={(v) => update("secretAccessKey", v)} />
            </div>
        );
    }

    if (type === "TOKEN") {
        return (
            <Field label="Token" type={secret} value={data.token ?? ""} onChange={(v) => update("token", v)} />
        );
    }

    if (type === "SMTP") {
        return (
            <div className="space-y-3">
                <Field label="User" value={data.user ?? ""} onChange={(v) => update("user", v)} />
                <Field label="Password" type={secret} value={data.password ?? ""} onChange={(v) => update("password", v)} />
            </div>
        );
    }

    if (type === "WEBHOOK") {
        return (
            <div className="space-y-3">
                <Field label="Webhook URL" type={secret} value={data.url ?? ""} onChange={(v) => update("url", v)} />
                <Field label="Auth header (optional)" type={secret} value={data.authHeader ?? ""} onChange={(v) => update("authHeader", v)} />
            </div>
        );
    }

    if (type === "OAUTH") {
        return (
            <div className="space-y-3">
                <Field label="Client ID" value={data.clientId ?? ""} onChange={(v) => update("clientId", v)} />
                <Field label="Client Secret" type={secret} value={data.clientSecret ?? ""} onChange={(v) => update("clientSecret", v)} />
            </div>
        );
    }

    return null;
}

function Field({
    label,
    value,
    onChange,
    type = "text",
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    type?: string;
}) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs">{label}</Label>
            <Input value={value} onChange={(e) => onChange(e.target.value)} type={type} />
        </div>
    );
}

// Strip empty optional fields and coerce to the right shape per type
function cleanData(type: CredentialType, raw: FormState): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
        if (v !== undefined && v !== "") out[k] = v;
    }
    // SSH_KEY: ensure authType present (default "password")
    if (type === "SSH_KEY" && !out.authType) out.authType = "password";
    return out;
}

function hasAnyValue(raw: FormState): boolean {
    return Object.values(raw).some((v) => v !== undefined && v !== "");
}
