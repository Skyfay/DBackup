/**
 * The secrets of a saved connection, filled into a config a form submits for it.
 *
 * The adapter DTO deletes every key in `SENSITIVE_KEYS` before a config reaches the browser, so an
 * edit of a saved connection submits its secrets missing, and the server fills them back in from
 * the saved config. That is only safe while the submitted config dials the places the saved one
 * does. A form that points the connection at another server, port or SSH host with its password
 * left blank would otherwise send the saved password, key or token to that server, whether it
 * tests the connection, browses its folders, lists its databases or saves it.
 *
 * So a stored secret is filled in only while the address stays the same, see `sameAddress`. Once
 * it changes, the form has to bring every secret the new address needs itself, typed into the form
 * or from a saved login, see `mergeStoredSecrets`. A saved login is no stored secret of the
 * connection: it is picked for a connection on purpose and signs in wherever that connection points.
 *
 * What counts as the address is what the adapter dials, from `dialed-hosts.ts`: the hosts of the
 * config in its mode and, for an SSH mode, also the hosts behind the SSH server, the `port` and
 * `sshPort` while both configs name one, and the scheme and port of a URL it dials. Two cases are
 * left out on purpose:
 *
 * - The bucket of an S3 storage. Its host is a name under the endpoint, which the operator of the
 *   endpoint controls, so a renamed bucket stays with the same server.
 * - An endpoint the adapter fixes itself, like Amazon S3, Google Drive, OneDrive, Dropbox,
 *   Telegram and Twilio. Their secrets only ever go to that provider, so a changed client id, chat
 *   or folder keeps them. The refresh token of a cloud drive belongs to the account of its client
 *   and the provider refuses it for another client, it never reaches anyone else.
 */

import { mergeSecrets, SENSITIVE_KEYS } from "@/lib/crypto";
import { ValidationError } from "@/lib/logging/errors";
import { slotKeysOf } from "./credential-keys";
import { dialedHosts, HostFormatError } from "./dialed-hosts";

type Config = Record<string, unknown>;

/** What a request is answered when it relies on a stored secret the form shows for another address. */
export const SECRETS_FOR_NEW_ADDRESS =
    "This connection now points at another address, so its saved password, key or token is not sent there. Enter it again for the new address.";

/** The same for a secret of the kind a saved login holds, which the form does not show. */
export const LOGIN_FOR_NEW_ADDRESS =
    "This connection now points at another address, so the password or key saved with it is not sent there. Pick a saved login for the new address.";

/** The adapters whose bucket names a host under their endpoint. */
const S3_BUCKET_HOSTS = new Set(["s3-generic", "s3-r2", "s3-hetzner"]);

/** The fields that hold a URL an adapter dials, whose scheme and port count beside its host. */
const URL_KEYS = ["webhookUrl", "serverUrl", "url", "endpoint"] as const;

/** The fields that hold a port. Each counts only while both configs name one, see `sameAddress`. */
const PORT_KEYS = ["port", "sshPort"] as const;

const isRecord = (value: unknown): value is Config => !!value && typeof value === "object" && !Array.isArray(value);
const isEmpty = (value: unknown) => value === undefined || value === null || value === "";
const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

/** The hosts a config dials, lower case. An address no client reads counts by its text. */
function hostsOf(adapterId: string, config: Config): string[] {
    try {
        return dialedHosts(adapterId, config).map((host) => host.toLowerCase());
    } catch (error) {
        if (error instanceof HostFormatError) return [`unreadable:${text(config.address)}`];
        throw error;
    }
}

/** The scheme and port of a URL, read like `urlHost` does, null when it names no host. */
function schemeAndPort(value: unknown): string | null {
    const raw = text(value);
    if (!raw) return null;
    for (const candidate of [raw, `https://${raw}`]) {
        try {
            const url = new URL(candidate);
            if (url.hostname) return `${url.protocol}${url.port}`;
        } catch {
            // Not a URL, the next form is tried.
        }
    }
    return null;
}

/**
 * Where a config connects to, as text to compare: its hosts in its mode and in direct mode, which
 * for an SSH mode are the hosts behind the SSH server, and the scheme and port of its URLs.
 */
export function addressOf(adapterId: string, config: Config): Set<string> {
    const view = S3_BUCKET_HOSTS.has(adapterId) ? { ...config, bucket: undefined } : config;
    const parts = new Set<string>();
    for (const mode of [view, { ...view, connectionMode: "direct" }]) {
        for (const host of hostsOf(adapterId, mode)) parts.add(`host:${host}`);
    }
    for (const key of URL_KEYS) {
        const url = schemeAndPort(view[key]);
        if (url) parts.add(`${key}:${url}`);
    }
    return parts;
}

/**
 * Whether two configs of an adapter connect to the same places. A port counts only while both
 * name one, since an older saved config may lack a port the form now fills with its default.
 */
export function sameAddress(adapterId: string, a: Config, b: Config): boolean {
    const left = addressOf(adapterId, a);
    const right = addressOf(adapterId, b);
    if (left.size !== right.size || [...left].some((part) => !right.has(part))) return false;
    return PORT_KEYS.every((key) => isEmpty(a[key]) || isEmpty(b[key]) || text(a[key]) === text(b[key]));
}

/** The keys of the secrets the merged config holds and the submitted one left empty, at any depth. */
function filledSecrets(submitted: unknown, merged: unknown): string[] {
    if (!isRecord(merged)) return [];
    const given = isRecord(submitted) ? submitted : {};
    return Object.entries(merged).flatMap(([key, value]) => {
        if (isRecord(value)) return filledSecrets(given[key], value);
        return SENSITIVE_KEYS.includes(key) && !isEmpty(value) && isEmpty(given[key]) ? [key] : [];
    });
}

/** The saved logins a connection signs in with after the request, which fill the keys of their slots. */
export interface AssignedLogins {
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
}

/**
 * The submitted config with the secrets it leaves out taken from the stored one, like
 * `mergeSecrets`, as long as both connect to the same places. A secret the caller submitted always
 * wins.
 *
 * Once the address changes, no stored secret is filled in. A secret the form shows has to be typed
 * again. One a saved login fills, which the form hides, like an inline password from before the
 * saved logins, is simply left behind while a saved login is assigned to its slot, and has to be
 * replaced by one otherwise.
 *
 * @throws ValidationError when the submitted config connects elsewhere and still relies on a
 *   stored secret, which has to be entered again or come from a saved login for the new address.
 */
export function mergeStoredSecrets(adapterId: string, submitted: unknown, stored: unknown, logins: AssignedLogins = {}): unknown {
    const merged = mergeSecrets(submitted, stored);
    if (!isRecord(submitted) || !isRecord(stored) || !isRecord(merged)) return merged;
    const filled = filledSecrets(submitted, merged);
    if (filled.length === 0 || sameAddress(adapterId, stored, merged)) return merged;

    const slots = slotKeysOf(adapterId);
    const covered = (key: string) =>
        (!!logins.primaryCredentialId && slots.primary.includes(key)) || (!!logins.sshCredentialId && slots.ssh.includes(key));
    const typed = (key: string) => !slots.primary.includes(key) && !slots.ssh.includes(key);
    if (filled.some(typed)) throw new ValidationError(SECRETS_FOR_NEW_ADDRESS, { field: "config" });
    if (!filled.every(covered)) throw new ValidationError(LOGIN_FOR_NEW_ADDRESS, { field: "config" });
    return submitted;
}
