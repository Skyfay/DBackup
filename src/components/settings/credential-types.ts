import { Cloud, Mail, ShieldCheck, SquareTerminal, Ticket, User, Webhook, type LucideIcon } from "lucide-react";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { ADAPTER_CREDENTIAL_REQUIREMENTS } from "@/lib/core/credential-requirements";
import type { CredentialType } from "@/lib/core/credentials";

export interface CredentialTypeInfo {
    /** The kind in the list and the head, like "SSH login". */
    title: string;
    /** For "New ..." and "Create ...", like "login" or "SSH login". */
    noun: string;
    /** What a profile of the kind holds, like "Key or password". */
    hint: string;
    icon: LucideIcon;
}

/** How each kind of credential profile is named and shown, wherever one is picked or created. */
export const CREDENTIAL_TYPE_INFO: Record<CredentialType, CredentialTypeInfo> = {
    USERNAME_PASSWORD: { title: "User and password", noun: "login", hint: "User and password", icon: User },
    SSH_KEY: { title: "SSH login", noun: "SSH login", hint: "Key or password", icon: SquareTerminal },
    ACCESS_KEY: { title: "Access key", noun: "access key", hint: "Key ID and secret", icon: Cloud },
    OAUTH: { title: "OAuth app", noun: "OAuth app", hint: "Client ID and secret", icon: ShieldCheck },
    TOKEN: { title: "API token", noun: "API token", hint: "API token", icon: Ticket },
    SMTP: { title: "SMTP login", noun: "SMTP login", hint: "SMTP user and password", icon: Mail },
    WEBHOOK: { title: "Webhook", noun: "webhook", hint: "URL and auth header", icon: Webhook },
};

/** The order of the list: databases and files first, then cloud storage, then notifications. */
export const CREDENTIAL_TYPE_ORDER: CredentialType[] = ["USERNAME_PASSWORD", "SSH_KEY", "ACCESS_KEY", "OAUTH", "TOKEN", "SMTP", "WEBHOOK"];

/**
 * The adapters that log in with a kind, by name, so the list says what each kind is for. Read
 * from the adapter declarations, so a new adapter shows up here without a change.
 */
export function servicesOf(type: CredentialType): string {
    const names = Object.entries(ADAPTER_CREDENTIAL_REQUIREMENTS)
        .filter(([, slots]) => slots.primary === type)
        .map(([id]) => getAdapterDefinition(id)?.name ?? id);
    // Databases and Docker hosts reach their server over SSH with the same kind.
    if (type === "SSH_KEY") names.push("the SSH server of any connection");
    return names.join(", ");
}

/** A field label as a noun inside a sentence: "Login" becomes "login", "SSH login" keeps its capitals. */
export function nounOf(label: string): string {
    return label
        .split(" ")
        .map((word) => (/^[A-Z][a-z]*$/.test(word) ? word.toLowerCase() : word))
        .join(" ");
}
