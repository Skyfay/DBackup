import { z } from "zod";
import type { AdapterDefinition } from "@/lib/adapters/definitions";
import type { CredentialType } from "@/lib/core/credentials";
import { sshManagedKeys } from "@/lib/adapters/ssh-key-convention";

/** What the connection form holds. The config is whatever the adapter's schema describes. */
export interface ConnectionFormValues {
    name: string;
    adapterId: string;
    config: Record<string, unknown>;
}

/** The config fields a credential profile of each type fills in, so the form never asks for them. */
const PRIMARY_CREDENTIAL_KEYS: Record<CredentialType, readonly string[]> = {
    USERNAME_PASSWORD: ["user", "username", "password"],
    // SFTP and Rsync: the SSH identity is the adapter's own, so its keys carry no prefix.
    SSH_KEY: ["username", "authType", "password", "privateKey", "passphrase"],
    ACCESS_KEY: ["accessKeyId", "secretAccessKey"],
    TOKEN: ["token", "appToken", "accessToken", "botToken", "authToken"],
    SMTP: ["user", "password"],
    WEBHOOK: ["webhookUrl", "url", "authHeader"],
    OAUTH: ["clientId", "clientSecret", "refreshToken"],
};

type Shape = Record<string, z.ZodType>;

function shapeOf(adapter: AdapterDefinition): Shape {
    return adapter.configSchema.shape as Shape;
}

/**
 * The config keys an assigned credential profile owns. The form hides them, and they are
 * optional in its schema, since a hidden required field would fail without saying so.
 */
export function credentialManagedKeys(adapter: AdapterDefinition): Set<string> {
    const keys = new Set<string>();
    const primary = adapter.credentials?.primary;
    if (primary) PRIMARY_CREDENTIAL_KEYS[primary].forEach((key) => keys.add(key));
    if (adapter.credentials?.ssh === "SSH_KEY") {
        sshManagedKeys(adapter.configSchema).forEach((key) => keys.add(key));
    }
    return keys;
}

/**
 * Whether the adapter cannot log in without its primary profile. True when one of the keys
 * the profile fills is required by the adapter's own schema, like a MySQL user.
 */
export function loginRequired(adapter: AdapterDefinition): boolean {
    const primary = adapter.credentials?.primary;
    if (!primary) return false;
    const shape = shapeOf(adapter);
    return PRIMARY_CREDENTIAL_KEYS[primary].some((key) => key in shape && !shape[key].safeParse(undefined).success);
}

/**
 * The schema the form validates against: the adapter's config, minus what a profile fills in.
 *
 * The connection mode loses its default here. The form shows nothing below it until one is
 * picked, since the two modes ask for different things, and a default would let Create
 * through on a mode nobody chose.
 */
export function buildConnectionFormSchema(adapter: AdapterDefinition) {
    const shape: Shape = { ...shapeOf(adapter) };

    for (const key of credentialManagedKeys(adapter)) {
        if (shape[key]) shape[key] = shape[key].optional();
    }
    if ("connectionMode" in shape) {
        shape.connectionMode = z.enum(["direct", "ssh"], { error: "Choose how DBackup connects." });
    }
    if (adapter.id === "sqlite") {
        shape.mode = z.enum(["local", "ssh"], { error: "Choose where the database file is." });
    }

    return z.object({
        name: z.string().min(1, "Name is required"),
        adapterId: z.string().min(1, "Type is required"),
        config: z.object(shape),
    });
}
