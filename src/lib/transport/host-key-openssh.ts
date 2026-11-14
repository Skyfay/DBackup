/**
 * The host key check of the OpenSSH client that rsync runs, the counterpart of `sshHostKeyCheck`
 * for a program DBackup only starts. ssh reads the key it trusts from a `known_hosts` file of the
 * call, never from the one of a home folder:
 *
 * - With a pin the file holds that one key and ssh runs with `StrictHostKeyChecking=yes`, so it
 *   ends before any login when the server presents another key.
 * - Without a pin the file starts empty and ssh runs with `accept-new`: it writes the key it saw
 *   into the file, which the caller reads once the login succeeded and reports as the first key.
 * - Without a file, the check of the connection is off: every key is accepted and none is
 *   remembered, as before pins existed.
 *
 * The line names the server by a fixed alias (`HostKeyAlias`) instead of its host and port. rsync
 * dials a checked address instead of the name for a tenant that blocks the local network, see
 * `rsync-pin.ts`, and the pin belongs to the connection whichever address its name resolves to.
 */

import { hostKeyFingerprint, type PinnedHostKey, type SeenHostKey } from "./host-key";

/** The name the one line of a `known_hosts` file of a call is stored under. */
export const HOST_KEY_ALIAS = "dbackup-pinned-host";

/** The `known_hosts` file of one call, and whether it holds the pin of the connection. */
export interface KnownHostsCheck {
    file: string;
    /** True with a pin in the file. False for an empty file that takes the first key. */
    pinned: boolean;
}

const KEY_TYPE = /^[A-Za-z0-9@._-]{1,64}$/;
const KEY_BLOB = /^[A-Za-z0-9+/]+={0,2}$/;

/** Whether a type and a base64 blob read as a public host key, and nothing that adds a line or an option. */
export function isHostKey(type: unknown, key: unknown): boolean {
    return typeof type === "string" && typeof key === "string" && KEY_TYPE.test(type) && key.length <= 8192 && KEY_BLOB.test(key);
}

/**
 * The `known_hosts` line of a pinned key under `HOST_KEY_ALIAS`.
 *
 * @throws Error for a pin that is no key, which would otherwise write a line of its own choosing.
 */
export function knownHostsLine(pinned: PinnedHostKey): string {
    if (!isHostKey(pinned.type, pinned.key)) throw new Error("The pinned SSH host key of this connection does not read as a key. Forget it in the connection and test the connection again.");
    return `${HOST_KEY_ALIAS} ${pinned.type} ${pinned.key}`;
}

/** The first key of a `known_hosts` file ssh wrote with `accept-new`, null for a file without one. */
export function firstKnownHostKey(content: string): SeenHostKey | null {
    for (const line of content.split("\n")) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 3 || fields[0].startsWith("#") || fields[0].startsWith("@")) continue;
        const [, type, key] = fields;
        if (!isHostKey(type, key)) continue;
        return { type, key, fingerprint: hostKeyFingerprint(Buffer.from(key, "base64")) };
    }
    return null;
}

/**
 * The `-o` options of the OpenSSH client for the host key of its server.
 *
 * Without a check the key is accepted and never remembered. Remembering it in ~/.ssh/known_hosts
 * gains nothing there, and costs twice: the Docker image's user has no home directory, so ssh
 * warned on every run that it could not write the file (#178), and LogLevel=ERROR hides the
 * "Permanently added" notice the /dev/null file prints instead, while a refused login or an
 * unreachable host still shows.
 *
 * With a check ssh reads the file of the call alone. `UpdateHostKeys=no` keeps it from adding
 * other keys of the server, `HashKnownHosts=no` and `CheckHostIP=no` keep the one line as it is
 * whatever the configuration of the machine says.
 */
export function opensshHostKeyOptions(check?: KnownHostsCheck): string[] {
    if (!check) return ["StrictHostKeyChecking=no", "UserKnownHostsFile=/dev/null", "LogLevel=ERROR"];
    return [
        `StrictHostKeyChecking=${check.pinned ? "yes" : "accept-new"}`,
        `UserKnownHostsFile=${check.file}`,
        "GlobalKnownHostsFile=/dev/null",
        `HostKeyAlias=${HOST_KEY_ALIAS}`,
        "HashKnownHosts=no",
        "UpdateHostKeys=no",
        "CheckHostIP=no",
        "LogLevel=ERROR",
    ];
}

const REFUSAL = /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|host key is known for|Host key for .* has changed/i;
const FINGERPRINT = /SHA256:[A-Za-z0-9+/]{43}/;

/**
 * Whether the output of ssh says it refused the host key of the server, with the fingerprint it
 * printed for the key it saw, null when it printed none. Null for any other output.
 */
export function opensshRefusal(output: string): { presented: string | null } | null {
    if (!REFUSAL.test(output)) return null;
    return { presented: FINGERPRINT.exec(output)?.[0] ?? null };
}
