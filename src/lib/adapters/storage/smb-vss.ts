/**
 * Shadow copies for SMB shares via MS-FSRVP (File Server Remote VSS Protocol).
 *
 * The file server is asked to snapshot a share and expose it under a separate UNC path;
 * the backup then reads from that path instead of the live tree. Windows Server 2012 and
 * newer implement this, as does Samba 4.2+. No agent is installed on the target.
 *
 * We drive Samba's `rpcclient`, which ships in the same `smbclient` package the image
 * already installs and implements the whole protocol. Nothing here speaks DCE/RPC itself.
 *
 * ## The 180-second trap
 *
 * `ExposeShadowCopySet` arms a Message Sequence Timer, and when it elapses the server
 * deletes every shadow copy set whose status is not "Recovered" (MS-FSRVP 3.1.5.7).
 * `RecoveryCompleteShadowCopySet` is what stops that timer and marks the set recovered -
 * and `rpcclient`'s `fss_create_expose` does *not* call it.
 *
 * So `fss_recovery_complete` has to run right after exposing, otherwise a Windows server
 * pulls the snapshot away three minutes in, which is less than any real backup takes.
 * Samba's own server happens to exempt exposed sets from that timeout, so this failure
 * appears only against real Windows - the worst way to find out.
 */

import { execFile } from "child_process";
import { logger } from "@/lib/logging/logger";
import { AdapterError } from "@/lib/logging/errors";
import type { SnapshotHandle } from "@/lib/core/interfaces";
import { stripTrailingSlashes } from "@/lib/paths";
import { isSmbAddress, parseSmbAddress, SMB_LOGIN_HINT, smbLoginHasPercent, smbResolveOptions } from "@/lib/adapters/smb-address";
import { sambaEnv } from "./smb-run";

const log = logger.child({ adapter: "smb", feature: "vss" });

interface ExecResult {
    stdout: string;
    stderr: string;
}

/**
 * Promise wrapper around execFile.
 *
 * Written out rather than using `promisify` so the only seam this module has to the
 * outside is `execFile` itself, which keeps it testable without mocking Node internals.
 */
function execFileAsync(command: string, args: string[], options: { timeout: number; env: NodeJS.ProcessEnv }): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
        execFile(command, args, options, (error, stdout, stderr) => {
            if (error) {
                reject(Object.assign(error, { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }));
                return;
            }
            resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
        });
    });
}

/** rpcclient is not interactive - a hung server must not hold a backup forever. */
const RPC_TIMEOUT_MS = 60_000;

/**
 * Auto-release, non-persistent, without writer involvement - the context meant for backing
 * up a file share. The server may reclaim it on its own, which is one more safeguard
 * against a snapshot we failed to release.
 */
const FSS_CONTEXT = "file_share_backup";

export interface SmbVssConfig {
    address: string;
    username?: string;
    password?: string;
    domain?: string;
}

/** Everything needed to release a snapshot later, encoded into `SnapshotHandle.id`. */
interface ShadowCopyRef {
    setId: string;
    shadowCopyId: string;
    baseShare: string;
}

function encodeRef(ref: ShadowCopyRef): string {
    return `${ref.setId}|${ref.shadowCopyId}|${ref.baseShare}`;
}

function decodeRef(id: string): ShadowCopyRef {
    const [setId, shadowCopyId, baseShare] = id.split("|");
    return { setId, shadowCopyId, baseShare };
}

/**
 * Splits `//server/share` into the host rpcclient binds to and the share it operates on.
 * Backslashes are accepted because that is how the path is written on Windows.
 */
export function splitShareAddress(address: string): { host: string; share: string } {
    const normalized = address.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    const slash = normalized.indexOf("/");
    if (slash === -1) {
        throw new AdapterError("smb", "vss", `Share address '${address}' is missing the share name (expected //server/share)`);
    }
    return { host: normalized.slice(0, slash), share: stripTrailingSlashes(normalized.slice(slash + 1)) };
}

/** The UNC form FSRVP expects for a share, e.g. `\\\\server\\share`. */
export function uncPath(host: string, share: string): string {
    return `\\\\${host}\\${share}`;
}

function credentialArgs(config: SmbVssConfig): string[] {
    // rpcclient reads a `%` in `-U` as the start of a password that wins over `PASSWD`, see
    // `smbLoginHasPercent`. Checked here as well as on save, since a config or a credential
    // profile may predate that check.
    if (smbLoginHasPercent(config.username) || smbLoginHasPercent(config.domain)) {
        throw new AdapterError("smb", "vss", SMB_LOGIN_HINT);
    }
    const user = config.username || "guest";
    const account = config.domain ? `${config.domain}\\${user}` : user;
    // The password travels in `PASSWD`, never in the argument vector, where anyone on the machine
    // reads it in the process table, see `sambaEnv`. Without one, `-N` keeps rpcclient from asking.
    return config.password ? ["-U", account] : ["-U", account, "-N"];
}

function scrub(text: string, password?: string): string {
    if (!password) return text;
    return text.split(password).join("****");
}

/**
 * A word rpcclient reads as one argument of one command. rpcclient splits its `-c` line into
 * commands at every semicolon, then each command into words at whitespace and quotes, so a server,
 * a share or an id with any of them would pass more arguments or run another command. A word that
 * starts with `-` reads as an option, of rpcclient for the server and of the command for the rest. A
 * share with a space works for a backup, smbclient takes the address as an argument of its own, but
 * not for a shadow copy.
 */
const RPC_WORD = /^[^\s;"'\x00-\x1f\x7f-][^\s;"'\x00-\x1f\x7f]*$/;

/** Refuses a word rpcclient would split or read as another command, see `RPC_WORD`. */
function assertRpcWord(word: string): void {
    if (RPC_WORD.test(word)) return;
    throw new AdapterError("smb", "vss", `Shadow copies need a server, a share and ids without whitespace, semicolons, quotes or control characters that do not start with a hyphen, and ${JSON.stringify(word)} is not one.`);
}

/**
 * Runs one rpcclient command. The address must have the form smbclient reads, see `isSmbAddress`,
 * and its words, and the server and share of the address whether this command names them or not,
 * are checked before the command line is built, so nothing of the address or of what the server
 * answered runs as a second command or reads as an option. rpcclient dials the server of
 * `parseSmbAddress`, the one the local network check of a tenant saw, never a binding string, and
 * looks it up in DNS alone while the tenant of the connection blocks the local network, see
 * `smbResolveOptions`.
 */
async function runRpc(config: SmbVssConfig, verb: string, words: string[] = []): Promise<string> {
    const { host: written, share } = splitShareAddress(config.address);
    for (const word of [written, share, ...words]) assertRpcWord(word);
    const parsed = parseSmbAddress(config.address);
    if (!parsed) {
        throw new AdapterError("smb", "vss", `Share address ${JSON.stringify(config.address)} is no share address of the form //server/share`);
    }
    const host = parsed.server;
    const command = [verb, ...words].join(" ");
    const args = [...credentialArgs(config), ...smbResolveOptions(config), "-c", command, host];

    try {
        const { stdout, stderr } = await execFileAsync("rpcclient", args, { timeout: RPC_TIMEOUT_MS, env: sambaEnv(config.password) });
        return `${stdout}${stderr}`;
    } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
        if (err.killed) {
            throw new AdapterError("smb", "vss", `Shadow copy request timed out after ${RPC_TIMEOUT_MS / 1000}s`);
        }
        const detail = scrub(`${err.stderr ?? ""}${err.stdout ?? ""}` || err.message || "unknown error", config.password);
        throw new AdapterError("smb", "vss", `rpcclient ${verb} failed:${detail.trim()}`);
    }
}

/**
 * Whether the server can snapshot this share.
 *
 * Never throws - the caller wants a yes/no with a reason it can show, and "the service is
 * not installed" is an expected answer rather than an error.
 */
export async function probeSnapshotSupport(config: SmbVssConfig): Promise<{ supported: boolean; message: string }> {
    const { host, share } = splitShareAddress(config.address);
    const unc = uncPath(host, share);

    try {
        const version = await runRpc(config, "fss_get_sup_version");
        const out = await runRpc(config, "fss_is_path_sup", [unc]);

        // "UNC %s %s shadow copy requests" - "supports" or "does not support".
        if (/does not support/i.test(out)) {
            return { supported: false, message: `The server reports that ${unc} does not support shadow copies.` };
        }
        if (!/supports/i.test(out)) {
            return { supported: false, message: `Unexpected response from the server: ${out.trim() || "(empty)"}` };
        }

        const versionMatch = version.match(/versions from (\d+) to (\d+)/i);
        const versionNote = versionMatch ? ` (FSRVP ${versionMatch[1]}-${versionMatch[2]})` : "";
        return { supported: true, message: `${unc} supports shadow copies${versionNote}.` };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { supported: false, message };
    }
}

/**
 * Creates a snapshot and exposes it, then immediately marks it recovery-complete.
 *
 * The second step is not optional - see the note on the 180-second timer at the top. If it
 * fails, the snapshot is released again rather than left to expire mid-backup.
 */
export async function createShadowCopy(config: SmbVssConfig): Promise<SnapshotHandle> {
    const { host, share } = splitShareAddress(config.address);
    const unc = uncPath(host, share);

    const output = await runRpc(config, "fss_create_expose", [FSS_CONTEXT, "ro", unc]);

    // "%s(%s): share %s exposed as a snapshot of %s" - set id, shadow copy id, the exposed
    // share, and the share it was taken from.
    const exposed = output.match(/([0-9a-f-]{36})\(([0-9a-f-]{36})\):\s*share\s+(\S+)\s+exposed as a snapshot of/i);
    if (!exposed) {
        throw new AdapterError("smb", "vss", `Could not read the exposed snapshot path from the server response: ${output.trim() || "(empty)"}`);
    }

    const [, setId, shadowCopyId, exposedShare] = exposed;
    const ref: ShadowCopyRef = { setId, shadowCopyId, baseShare: unc };
    // The exposed share is a full UNC path; the adapter addresses shares as //server/share.
    const address = exposedShare.replace(/\\/g, "/");
    const handle: SnapshotHandle = {
        id: encodeRef(ref),
        configOverride: { address },
        label: exposedShare,
        // What VSS actually calls it, and what the log has always said. Stated explicitly
        // now that the runner no longer assumes every adapter makes shadow copies.
        noun: "shadow copy",
    };

    // The server names the share to read, so it must have the form of a configured one before
    // anything reads it. Its host is checked like the configured one by the runner, see
    // `acquireGroupSnapshot` in `collect-directories.ts`.
    if (!isSmbAddress(address)) {
        await releaseShadowCopy(config, handle).catch(() => { });
        throw new AdapterError("smb", "vss", `The server exposed the shadow copy as '${exposedShare}', which is no share address of the form //server/share`);
    }

    try {
        await runRpc(config, "fss_recovery_complete", [setId]);
    } catch (error: unknown) {
        // Better no snapshot than one the server deletes while we are reading from it.
        await releaseShadowCopy(config, handle).catch(() => { });
        throw error;
    }

    log.info("Shadow copy exposed", { host, share, setId });
    return handle;
}

/** Releases a snapshot. A snapshot that is already gone counts as success. */
export async function releaseShadowCopy(config: SmbVssConfig, handle: SnapshotHandle): Promise<void> {
    const { setId, shadowCopyId, baseShare } = decodeRef(handle.id);
    try {
        await runRpc(config, "fss_delete", [baseShare, setId, shadowCopyId]);
        log.info("Shadow copy released", { setId });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (/does not exist|SHADOWCOPYSET_ID_MISMATCH/i.test(message)) return;
        throw error;
    }
}

/**
 * Finds a snapshot left behind by a run that never got to release it - a killed container,
 * an OOM. FSRVP refuses to start a new set while one is in progress, so a leftover would
 * block every future backup of this share.
 *
 * The server only tracks one association per share, so this yields at most one handle.
 */
export async function findOrphanedShadowCopies(config: SmbVssConfig): Promise<SnapshotHandle[]> {
    const { host, share } = splitShareAddress(config.address);
    const unc = uncPath(host, share);

    let output: string;
    try {
        output = await runRpc(config, "fss_has_shadow_copy", [unc]);
    } catch {
        // Not being able to ask is not the same as there being one - the caller's own
        // create attempt will produce the real error if something is genuinely wrong.
        return [];
    }

    if (!/has an associated shadow-copy/i.test(output)) return [];

    const mapping = await runRpc(config, "fss_get_mapping", [unc]).catch(() => "");
    const ids = mapping.match(/([0-9a-f-]{36})\(([0-9a-f-]{36})\)/i);
    if (!ids) {
        log.warn("Share reports a leftover shadow copy but its ids could not be read", { host, share });
        return [];
    }

    const [, setId, shadowCopyId] = ids;
    return [{
        id: encodeRef({ setId, shadowCopyId, baseShare: unc }),
        configOverride: {},
        label: unc,
        noun: "shadow copy",
    }];
}
