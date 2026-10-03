/**
 * The one place a backup's encryption key is resolved.
 *
 * Every flow that opens an encrypted backup - database restore, file restore, storage
 * download, config restore - goes through `resolveBackupKey`. Before this existed each of
 * them had its own idea of what to try and in which order, which meant a backup whose
 * profile had been deleted was recoverable in one place and a dead end in another.
 *
 * The order is fixed:
 *
 * 1. A key the caller supplied, from the recovery dialog. An explicit choice is never
 *    silently second-guessed - if it does not fit, that is what the user is told.
 * 2. The profile the backup's metadata names. Present and readable means trusted, with no
 *    verification: it is the normal case, and proving it would cost a read on every restore.
 * 3. Smart Recovery - every profile in the vault, tested against the backup. This is what
 *    saves a backup whose profile was deleted and the same key later re-imported under a
 *    new id.
 *
 * Step 3 needs a way to tell a fitting key from a wrong one, and that differs per format,
 * so it is supplied by the caller as a `KeyVerifier`. For a v2 archive the answer is exact
 * (the index is AEAD-sealed, so a wrong key cannot parse); for a whole-file encrypted dump
 * it is a content heuristic, because the authentication tag covers the entire stream and
 * checking it would mean reading the whole backup once per candidate.
 */

import { deriveArchiveKeys } from "@/lib/crypto/kdf";
import { parseIndex } from "@/lib/archive/index-file";
import { EncryptionKeyRequiredError, ValidationError, getErrorMessage } from "@/lib/logging/errors";
import { getEncryptionProfiles, getProfileMasterKey } from "./encryption-service";
import { rememberKeyFor } from "@/services/vault/key-aliases";

/**
 * Progress sink. Restores write these into the execution log where the user reads them, so
 * the wording matters: it is the only account of why a backup did or did not open.
 */
export type KeyResolutionLog = (
    msg: string,
    level?: "info" | "warning" | "error" | "success" | "debug"
) => void;

/**
 * A key the user chose in the recovery dialog, which takes precedence over anything the
 * backup's metadata says. Exactly one of the two fields is set.
 */
export interface KeyOverride {
    /** Raw 32-byte master key as 64 hex characters, as exported by the Recovery Kit. */
    rawKeyHex?: string;
    /** Open the backup with this vault profile instead of the one it names. */
    profileId?: string;
}

/**
 * Decides whether a candidate key actually opens this backup.
 *
 * Returns false for a key that does not fit - it must not throw for that, since a wrong
 * candidate is the expected case while Smart Recovery walks the vault.
 */
export type KeyVerifier = (candidate: Buffer) => Promise<boolean>;

export interface KeyResolutionRequest {
    /** Profile the backup's metadata names. May be absent, or point at a deleted profile. */
    profileId?: string;
    override?: KeyOverride;
    /** Omit only when the format offers no way to test a key - Smart Recovery is then skipped. */
    verify?: KeyVerifier;
    log?: KeyResolutionLog;
}

const MASTER_KEY_HEX = /^[0-9a-fA-F]{64}$/;

/** Resolves the master key for an encrypted backup. See the module comment for the order. */
export async function resolveBackupKey({
    profileId,
    override,
    verify,
    log,
}: KeyResolutionRequest): Promise<Buffer> {
    const say: KeyResolutionLog = log ?? (() => { });

    // ── 1. The user's explicit choice ─────────────────────────────────────
    if (override?.rawKeyHex || override?.profileId) {
        const key = override.rawKeyHex
            ? parseRawKey(override.rawKeyHex)
            : await getProfileMasterKey(override.profileId!);

        // Verified rather than trusted, unlike the metadata's own profile: a pasted key is
        // the one input nobody has checked, and handing a wrong one to the decryption
        // pipeline surfaces as "the archive is corrupt", which sends the user hunting for
        // the wrong problem.
        if (verify && !(await verify(key))) {
            throw new EncryptionKeyRequiredError(
                "The supplied key does not open this backup.",
                profileId
            );
        }
        return key;
    }

    // ── 2. The profile the backup names ───────────────────────────────────
    if (profileId) {
        try {
            return await getProfileMasterKey(profileId);
        } catch {
            say(`Profile ${profileId} not found. Attempting Smart Recovery...`, "warning");
        }
    }

    // ── 3. Smart Recovery ─────────────────────────────────────────────────
    if (!verify) {
        throw new EncryptionKeyRequiredError(
            `Encryption profile ${profileId ?? "(unknown)"} is missing, and this backup offers no way to test another key.`,
            profileId
        );
    }

    const profiles = await getEncryptionProfiles();
    say(`Smart Recovery: Found ${profiles.length} candidate profile(s).`, "info");

    for (const profile of profiles) {
        say(`Smart Recovery: Testing profile '${profile.name}' (${profile.id})...`, "info");
        try {
            const candidate = await getProfileMasterKey(profile.id);
            if (await verify(candidate)) {
                say(`Smart Recovery Successful: Matched key from profile '${profile.name}'.`, "success");
                // So the Vault counts the backups of the missing profile under the key that opens them.
                await rememberKeyFor(profile.id, profileId);
                return candidate;
            }
        } catch (e: unknown) {
            say(`Smart Recovery: Profile '${profile.name}' threw error: ${getErrorMessage(e)}`, "warning");
        }
    }

    throw new EncryptionKeyRequiredError(
        `Encryption profile ${profileId ?? "(unknown)"} is missing, and no other profile could decrypt this file.`,
        profileId
    );
}

function parseRawKey(keyHex: string): Buffer {
    const clean = keyHex.trim();
    if (!MASTER_KEY_HEX.test(clean)) {
        throw new ValidationError(
            "Invalid encryption key format. Must be a 64-character hex string (32 bytes).",
            { field: "rawKeyHex" }
        );
    }
    return Buffer.from(clean, "hex");
}

/** The cleartext crypto parameters of a v2 archive, from its manifest or its `.meta.json`. */
export interface ArchiveKeyParams {
    /** Hex-encoded per-archive HKDF salt. */
    kdfSalt: string;
    /** Hex-encoded nonce prefix. */
    noncePrefix: string;
}

/**
 * Verifier for a seekable (v2) archive, testing a candidate against the archive's index.
 *
 * Exact, not heuristic: the index is sealed with AES-256-GCM, so a wrong key fails its
 * authentication tag and can never parse. It is also cheap - the index is already in hand
 * when this runs, so testing the whole vault costs no further I/O.
 *
 * @param indexBytes - The sealed index, from the sidecar or the archive's index member
 * @param params - The archive's `kdfSalt` and `noncePrefix`, both cleartext by design
 */
export function archiveIndexVerifier(indexBytes: Buffer, params: ArchiveKeyParams): KeyVerifier {
    const noncePrefix = Buffer.from(params.noncePrefix, "hex");
    const kdfSalt = Buffer.from(params.kdfSalt, "hex");

    return async (candidate: Buffer) => {
        try {
            const { indexKey } = deriveArchiveKeys(candidate, kdfSalt);
            await parseIndex(indexBytes, { indexKey, noncePrefix });
            return true;
        } catch {
            return false;
        }
    };
}
