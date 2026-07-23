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
function execFileAsync(command: string, args: string[], options: { timeout: number }): Promise<ExecResult> {
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
    const normalized = address.replace(/\\/g, "/").replace(/^\/+/, "");
    const slash = normalized.indexOf("/");
    if (slash === -1) {
        throw new AdapterError("smb", "vss", `Share address '${address}' is missing the share name (expected //server/share)`);
    }
    return { host: normalized.slice(0, slash), share: normalized.slice(slash + 1).replace(/\/+$/, "") };
}

/** The UNC form FSRVP expects for a share, e.g. `\\\\server\\share`. */
export function uncPath(host: string, share: string): string {
    return `\\\\${host}\\${share}`;
}

function credentialArgs(config: SmbVssConfig): string[] {
    const user = config.username || "guest";
    const account = config.domain ? `${config.domain}\\${user}` : user;
    // The password travels in the argument vector rather than the environment because
    // rpcclient offers no other non-interactive way. It is scrubbed from every log below.
    return ["-U", `${account}%${config.password ?? ""}`];
}

function scrub(text: string, password?: string): string {
    if (!password) return text;
    return text.split(password).join("****");
}

async function runRpc(config: SmbVssConfig, command: string): Promise<string> {
    const { host } = splitShareAddress(config.address);
    const args = [...credentialArgs(config), "-c", command, host];

    try {
        const { stdout, stderr } = await execFileAsync("rpcclient", args, { timeout: RPC_TIMEOUT_MS });
        return `${stdout}${stderr}`;
    } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
        if (err.killed) {
            throw new AdapterError("smb", "vss", `Shadow copy request timed out after ${RPC_TIMEOUT_MS / 1000}s`);
        }
        const detail = scrub(`${err.stderr ?? ""}${err.stdout ?? ""}` || err.message || "unknown error", config.password);
        throw new AdapterError("smb", "vss", `rpcclient ${command.split(" ")[0]} failed: ${detail.trim()}`);
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
        const out = await runRpc(config, `fss_is_path_sup ${unc}`);

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

    const output = await runRpc(config, `fss_create_expose ${FSS_CONTEXT} ro ${unc}`);

    // "%s(%s): share %s exposed as a snapshot of %s" - set id, shadow copy id, the exposed
    // share, and the share it was taken from.
    const exposed = output.match(/([0-9a-f-]{36})\(([0-9a-f-]{36})\):\s*share\s+(\S+)\s+exposed as a snapshot of/i);
    if (!exposed) {
        throw new AdapterError("smb", "vss", `Could not read the exposed snapshot path from the server response: ${output.trim() || "(empty)"}`);
    }

    const [, setId, shadowCopyId, exposedShare] = exposed;
    const ref: ShadowCopyRef = { setId, shadowCopyId, baseShare: unc };
    const handle: SnapshotHandle = {
        id: encodeRef(ref),
        // The exposed share is a full UNC path; the adapter addresses shares as //server/share.
        configOverride: { address: exposedShare.replace(/\\/g, "/") },
        label: exposedShare,
    };

    try {
        await runRpc(config, `fss_recovery_complete ${setId}`);
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
        await runRpc(config, `fss_delete ${baseShare} ${setId} ${shadowCopyId}`);
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
        output = await runRpc(config, `fss_has_shadow_copy ${unc}`);
    } catch {
        // Not being able to ask is not the same as there being one - the caller's own
        // create attempt will produce the real error if something is genuinely wrong.
        return [];
    }

    if (!/has an associated shadow-copy/i.test(output)) return [];

    const mapping = await runRpc(config, `fss_get_mapping ${unc}`).catch(() => "");
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
    }];
}
