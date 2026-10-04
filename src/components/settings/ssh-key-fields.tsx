"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { CredentialField } from "./credential-field";
import type { SshFieldState, SshKeySource } from "./ssh-key-payload";
import { SSH_KEY_TYPES, type SshKeyType } from "@/lib/core/credentials";

const KEY_TYPE_LABELS: Record<SshKeyType, string> = {
    ed25519: "Ed25519 (recommended)",
    "rsa-4096": "RSA 4096",
    "ecdsa-p256": "ECDSA P-256",
    "ecdsa-p384": "ECDSA P-384",
};

const AUTH_METHODS = [
    { value: "password", title: "Password", description: "The password of the SSH user." },
    { value: "privateKey", title: "Private key", description: "A key you paste or DBackup makes." },
    { value: "agent", title: "SSH agent", description: "The agent running beside DBackup." },
];

const KEY_SOURCES = [
    { value: "paste", title: "Use my key", description: "Paste a key you already have." },
    { value: "generate", title: "Generate one", description: "DBackup makes a keypair and shows the public key." },
];

/** A pasted private key, masked like a password until its eye is pressed. */
function PrivateKeyField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const id = useId();
    const [shown, setShown] = useState(false);
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <Label htmlFor={id}>Private key</Label>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 text-muted-foreground"
                    aria-label={shown ? "Hide private key" : "Show private key"}
                    aria-pressed={shown}
                    onClick={() => setShown((current) => !current)}
                >
                    {shown ? <EyeOff /> : <Eye />}
                </Button>
            </div>
            <Textarea
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-16 resize-y font-mono text-xs field-sizing-fixed"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                autoComplete="off"
                spellCheck={false}
                style={!shown ? ({ WebkitTextSecurity: "disc", textSecurity: "disc" } as React.CSSProperties) : undefined}
            />
            {value.includes("BEGIN ENCRYPTED PRIVATE KEY") && (
                <p className="text-xs text-warning">This key is encrypted, so it needs its passphrase below.</p>
            )}
        </div>
    );
}

/**
 * Payload fields of an `SSH_KEY` credential profile.
 *
 * The way to sign in and the source of the key change what the form asks for, so both are
 * cards rather than selects. Private-key auth can take a pasted key or ask DBackup to generate
 * one. The generate path sends a `generate` request instead of key material, so the private key
 * is created on the server and never reaches the browser.
 */
export function SshKeyFields({
    data,
    update,
    defaultComment,
}: {
    data: SshFieldState;
    update: (key: string, value: string) => void;
    /** Suggested key comment, derived from the profile name. */
    defaultComment: string;
}) {
    const authType = data.authType ?? "password";
    const keySource = (data.keySource ?? "paste") as SshKeySource;
    const keyTypeId = useId();

    return (
        <div className="space-y-4">
            <CredentialField label="Username" value={data.username ?? ""} onChange={(v) => update("username", v)} />

            <div className="space-y-2">
                <Label id={`${keyTypeId}-auth`}>Sign in with</Label>
                <ChoiceCards
                    value={authType}
                    onValueChange={(value) => update("authType", value)}
                    options={AUTH_METHODS}
                    aria-labelledby={`${keyTypeId}-auth`}
                    className="grid gap-2.5 sm:grid-cols-3"
                />
            </div>

            {authType === "password" && (
                <CredentialField label="Password" secret value={data.password ?? ""} onChange={(v) => update("password", v)} />
            )}

            {authType === "privateKey" && (
                <>
                    <div className="space-y-2">
                        <Label id={`${keyTypeId}-source`}>Key</Label>
                        <ChoiceCards
                            value={keySource}
                            onValueChange={(value) => update("keySource", value)}
                            options={KEY_SOURCES}
                            aria-labelledby={`${keyTypeId}-source`}
                        />
                    </div>

                    {keySource === "paste" ? (
                        <>
                            <PrivateKeyField value={data.privateKey ?? ""} onChange={(v) => update("privateKey", v)} />
                            <CredentialField label="Key passphrase" hint="Optional" secret value={data.passphrase ?? ""} onChange={(v) => update("passphrase", v)} />
                        </>
                    ) : (
                        <>
                            <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
                                <div className="space-y-2">
                                    <Label htmlFor={keyTypeId}>Key type</Label>
                                    <Select value={data.keyType ?? "ed25519"} onValueChange={(v) => update("keyType", v)}>
                                        <SelectTrigger id={keyTypeId} className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {SSH_KEY_TYPES.map((t) => (
                                                <SelectItem key={t} value={t}>
                                                    {KEY_TYPE_LABELS[t]}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <CredentialField
                                    label="Comment"
                                    hint="In authorized_keys"
                                    value={data.keyComment ?? ""}
                                    onChange={(v) => update("keyComment", v)}
                                    placeholder={defaultComment}
                                />
                            </div>
                            <CredentialField label="Key passphrase" hint="Optional" secret value={data.passphrase ?? ""} onChange={(v) => update("passphrase", v)} />
                            {data.passphrase && (
                                <p className="text-xs text-warning">
                                    A Rsync destination cannot use a key with a passphrase. It runs the OpenSSH client in batch
                                    mode, which has no way to answer the prompt.
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                The keypair is made on the server when you save. The private key is stored encrypted and never
                                shown, the public key comes up afterwards so you can install it on the host.
                            </p>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
