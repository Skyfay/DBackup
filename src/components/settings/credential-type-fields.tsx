"use client";

import type { CredentialType } from "@/lib/core/credentials";
import { CredentialField } from "./credential-field";
import { SshKeyFields } from "./ssh-key-fields";
import { buildSshPayload, hasSshPayload } from "./ssh-key-payload";

export type FormState = Record<string, string | undefined>;

/** The empty payload of each kind, which is also what a change of kind resets to. */
export const DEFAULTS: Record<CredentialType, FormState> = {
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

/** The secret of a profile, with the fields its kind asks for. */
export function TypeFields({
    type,
    data,
    setData,
    defaultComment,
}: {
    type: CredentialType;
    data: FormState;
    setData: (next: FormState) => void;
    /** Suggested key comment for a generated SSH key, derived from the profile name. */
    defaultComment: string;
}) {
    const update = (key: string, value: string) => setData({ ...data, [key]: value });

    switch (type) {
        case "USERNAME_PASSWORD":
            return (
                <div className="grid gap-4 sm:grid-cols-2">
                    <CredentialField label="Username" value={data.username ?? ""} onChange={(v) => update("username", v)} />
                    <CredentialField label="Password" secret value={data.password ?? ""} onChange={(v) => update("password", v)} />
                </div>
            );
        case "SSH_KEY":
            return <SshKeyFields data={data} update={update} defaultComment={defaultComment} />;
        case "ACCESS_KEY":
            return (
                <div className="space-y-4">
                    <CredentialField label="Access key ID" value={data.accessKeyId ?? ""} onChange={(v) => update("accessKeyId", v)} />
                    <CredentialField label="Secret access key" secret value={data.secretAccessKey ?? ""} onChange={(v) => update("secretAccessKey", v)} />
                </div>
            );
        case "TOKEN":
            return <CredentialField label="Token" secret value={data.token ?? ""} onChange={(v) => update("token", v)} />;
        case "SMTP":
            return (
                <div className="grid gap-4 sm:grid-cols-2">
                    <CredentialField label="User" value={data.user ?? ""} onChange={(v) => update("user", v)} />
                    <CredentialField label="Password" secret value={data.password ?? ""} onChange={(v) => update("password", v)} />
                </div>
            );
        case "WEBHOOK":
            return (
                <div className="space-y-4">
                    <CredentialField label="Webhook URL" secret value={data.url ?? ""} onChange={(v) => update("url", v)} />
                    <CredentialField label="Auth header" hint="Optional" secret value={data.authHeader ?? ""} onChange={(v) => update("authHeader", v)} />
                </div>
            );
        case "OAUTH":
            return (
                <div className="space-y-4">
                    <CredentialField label="Client ID" value={data.clientId ?? ""} onChange={(v) => update("clientId", v)} />
                    <CredentialField label="Client secret" secret value={data.clientSecret ?? ""} onChange={(v) => update("clientSecret", v)} />
                    <p className="text-xs text-muted-foreground">The refresh token is added on its own once the connection is authorized.</p>
                </div>
            );
        default:
            return null;
    }
}

// Strip empty optional fields and coerce to the right shape per type
export function cleanData(
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

/** Whether anything of the secret was typed in, which is what an edit replaces it with. */
export function hasAnyValue(type: CredentialType, raw: FormState): boolean {
    if (type === "SSH_KEY") return hasSshPayload(raw);
    return Object.values(raw).some((v) => v !== undefined && v !== "");
}
