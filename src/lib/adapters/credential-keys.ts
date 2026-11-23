/**
 * The config keys a credential profile fills in, per profile type. The connection form hides
 * them, since a saved login is picked rather than typed, and the server knows from them which
 * secrets of a stored config nobody can type again in the form, see `stored-secrets.ts`.
 */

import type { CredentialType } from "@/lib/core/credentials";
import { getCredentialRequirements } from "@/lib/core/credential-requirements";
import { getAdapterDefinition } from "./definitions";
import { sshManagedKeys } from "./ssh-key-convention";

/** The config fields a credential profile of each type fills in, so the form never asks for them. */
export const PRIMARY_CREDENTIAL_KEYS: Record<CredentialType, readonly string[]> = {
    USERNAME_PASSWORD: ["user", "username", "password"],
    // SFTP and Rsync: the SSH identity is the adapter's own, so its keys carry no prefix.
    SSH_KEY: ["username", "authType", "password", "privateKey", "passphrase"],
    ACCESS_KEY: ["accessKeyId", "secretAccessKey"],
    TOKEN: ["token", "appToken", "accessToken", "botToken", "authToken"],
    SMTP: ["user", "password"],
    WEBHOOK: ["webhookUrl", "url", "authHeader"],
    OAUTH: ["clientId", "clientSecret", "refreshToken"],
};

type Credentials = { primary?: CredentialType; ssh?: CredentialType } | undefined;
type SchemaLike = { shape: Record<string, unknown> } | undefined;

/** The config keys the credential profiles of an adapter own, by its credential slots and the shape of its schema. */
export function managedConfigKeys(credentials: Credentials, schema: SchemaLike): Set<string> {
    const keys = new Set<string>();
    if (credentials?.primary) PRIMARY_CREDENTIAL_KEYS[credentials.primary].forEach((key) => keys.add(key));
    if (credentials?.ssh === "SSH_KEY") sshManagedKeys(schema).forEach((key) => keys.add(key));
    return keys;
}

/** The config keys each credential slot of an adapter owns, its login and its SSH login. Empty for a slot it lacks. */
export function slotKeysOf(adapterId: string): { primary: readonly string[]; ssh: readonly string[] } {
    const credentials = getCredentialRequirements(adapterId);
    return {
        primary: credentials?.primary ? PRIMARY_CREDENTIAL_KEYS[credentials.primary] : [],
        ssh: credentials?.ssh === "SSH_KEY" ? sshManagedKeys(getAdapterDefinition(adapterId)?.configSchema) : [],
    };
}
