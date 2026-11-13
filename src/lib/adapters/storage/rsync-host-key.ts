import fs from "fs/promises";
import path from "path";

import type { StorageAdapter, StorageSession } from "@/lib/core/interfaces";
import { privateTempDir, writeNewFile } from "@/lib/private-temp-dir";
import { hostKeyMismatch, hostKeyOf, type SshHostKeyPolicy } from "@/lib/transport/host-key";
import { firstKnownHostKey, knownHostsLine, opensshRefusal } from "@/lib/transport/host-key-openssh";

/**
 * The host key check of the rsync adapter, whose ssh is a program of its own. Every method of the
 * adapter that takes a config first runs with a `known_hosts` file of that call, in a folder of
 * its own that nobody else opens: with the pinned key of the connection, so ssh ends before any
 * login when the server presents another one, or empty, so ssh writes the key of the first login
 * into it and the connection pins that. See `host-key-openssh.ts`. A config without a host key
 * policy, the one of a connection with the check switched off, runs as before.
 */

/** The fields that carry the check of one call to `rsync.ts`, set here and never stored. */
export interface KnownHosts {
    /** The `known_hosts` file of the call. Absent: ssh accepts every key. */
    knownHostsFile?: string;
    /** Whether the file holds the pin of the connection, so ssh refuses any other key. */
    strictHostKey?: boolean;
    /** Told when ssh refused the host key, with the fingerprint it printed, if any. */
    onHostKeyRefused?: (presented: string | null) => void;
}

/** The methods that answer a failure with a result instead of throwing it. */
const ANSWERS = new Set(["test", "ping"]);

const failed = (result: unknown): result is { success: false; message?: unknown } =>
    typeof result === "object" && result !== null && (result as { success?: unknown }).success === false;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Reports the key ssh wrote into the file of a first login to the policy. */
async function pinFirstKey(file: string, policy: SshHostKeyPolicy): Promise<void> {
    if (policy.pinned || !policy.onFirstKey) return;
    const seen = firstKnownHostKey(await fs.readFile(file, "utf8").catch(() => ""));
    if (seen) await policy.onFirstKey(seen);
}

/**
 * The adapter with every method that takes a config first run under the host key check of that
 * config. A refused key fails `test` and `ping` with the sentence of the mismatch and throws
 * `HostKeyMismatchError` from every other method, also where the method itself would only have
 * logged the output of ssh and answered false.
 */
export function withRsyncHostKey(adapter: StorageAdapter): StorageAdapter {
    const checked: Record<string, unknown> = { ...adapter };
    for (const [name, value] of Object.entries(adapter)) {
        if (typeof value !== "function") continue;
        const method = value as (config: object, ...rest: unknown[]) => Promise<unknown>;
        checked[name] = async (config: object, ...rest: unknown[]) => {
            const policy = hostKeyOf(config);
            if (!policy || (!policy.pinned && !policy.onFirstKey)) return method.call(checked, config, ...rest);

            // A folder of the call inside the private folder of DBackup, which outlives the call for a session.
            const dir = await fs.mkdtemp(path.join(await privateTempDir(), "rsync-hosts-"));
            const cleanup = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {});
            const file = path.join(dir, "known_hosts");
            let refused: { presented: string | null } | null = null;
            const mismatch = () => hostKeyMismatch(policy, refused?.presented ?? null);
            let keep = false;
            try {
                await writeNewFile(file, policy.pinned ? `${knownHostsLine(policy.pinned)}\n` : "");
                const ready: object & KnownHosts = {
                    ...config,
                    knownHostsFile: file,
                    strictHostKey: !!policy.pinned,
                    onHostKeyRefused: (presented) => { refused ??= { presented }; },
                };

                let result: unknown;
                try {
                    result = await method.call(checked, ready, ...rest);
                } catch (error: unknown) {
                    refused ??= policy.pinned ? opensshRefusal(messageOf(error)) : null;
                    if (!refused) throw error;
                    if (ANSWERS.has(name)) return { success: false, message: mismatch().message };
                    throw mismatch();
                }
                if (failed(result)) refused ??= policy.pinned ? opensshRefusal(String(result.message ?? "")) : null;
                if (refused) {
                    // A session that fell back to one login per transfer would fail each of them the same way.
                    if (name === "openSession") await (result as StorageSession | undefined)?.close?.().catch(() => {});
                    if (failed(result)) return { ...result, message: mismatch().message };
                    throw mismatch();
                }
                // A method that answers a failure never logged in, so its server pins nothing.
                if (!failed(result) && result !== false) await pinFirstKey(file, policy);

                if (name === "openSession" && result && typeof result === "object") {
                    // The transfers of a session log in later, so its file lives until the session closes.
                    keep = true;
                    return sessionUnderCheck(result as StorageSession, () => (refused ? mismatch() : null), cleanup);
                }
                return result;
            } finally {
                if (!keep) await cleanup();
            }
        };
    }
    return checked as unknown as StorageAdapter;
}

/** A session whose transfers throw the mismatch ssh reported, and that removes its file when it closes. */
function sessionUnderCheck(session: StorageSession, refusal: () => Error | null, cleanup: () => Promise<void>): StorageSession {
    const under = <A extends unknown[], R>(call: ((...args: A) => Promise<R>) | undefined) =>
        call && (async (...args: A): Promise<R> => {
            const result = await call.apply(session, args);
            const error = refusal();
            if (error) throw error;
            return result;
        });
    return {
        ...session,
        upload: under(session.upload)!,
        ...(session.download ? { download: under(session.download) } : {}),
        close: async () => {
            try {
                await session.close();
            } finally {
                await cleanup();
            }
        },
    };
}
