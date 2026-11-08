import { createReadStream, createWriteStream, promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import type { Readable, Transform } from "stream";
import { createGunzip } from "zlib";
import { createDecryptionStream } from "@/lib/crypto/stream";
import { privateTempPath, PRIVATE_FILE_MODE } from "@/lib/private-temp-dir";
import { logger } from "@/lib/logging/logger";
import { EncryptionKeyRequiredError, ValidationError } from "@/lib/logging/errors";
import { resolveBackupKey, type KeyOverride, type KeyResolutionRequest, type KeyVerifier } from "@/services/backup/key-resolution";
import { legacyStreamVerifier, resolveDecryptionKey } from "@/services/restore/smart-recovery";
import { getConfigBackupKeyId } from "./config-backup-targets";

const log = logger.child({ service: "ConfigRestore" });

/** How a configuration backup is stored, from its `.meta.json` in either of its two shapes or its name. */
interface StoredAs {
    encrypted: boolean;
    compressed: boolean;
    iv?: string;
    authTag?: string;
    profileId?: string;
}

function storedAs(fileName: string, meta: Record<string, unknown> | null): StoredAs {
    const nested = meta?.encryption && typeof meta.encryption === "object" ? (meta.encryption as Record<string, unknown>) : null;
    const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
    return {
        encrypted: fileName.endsWith(".enc") || !!nested?.enabled || !!meta?.iv,
        compressed: fileName.includes(".gz") || String(meta?.compression ?? "").toUpperCase() === "GZIP",
        iv: text(nested?.iv) ?? text(meta?.iv),
        authTag: text(nested?.authTag) ?? text(meta?.authTag),
        profileId: text(nested?.profileId) ?? text(meta?.encryptionProfileId),
    };
}

/** What someone reads who picks a configuration backup at a destination that is not encrypted. */
export const UNENCRYPTED_AT_DESTINATION = "A configuration backup at a destination is restored only when it is encrypted, as DBackup always writes it. Anyone who may restore files into that destination could have put a plain one there. Download it and upload it here to restore it anyway.";

/** What someone reads whose configuration backup at a destination does not open with the key of the configuration backup. */
export const NOT_CONFIG_BACKUP_KEY = "A configuration backup at a destination opens on its own only with the key picked under Configuration backup. Anyone who may add a key to the Vault and write into the destination could have put a file there with a key of their own. Pick or type its key, or download it and upload it here to restore it anyway.";

/**
 * Whether a configuration backup is stored encrypted, by its name or its `.meta.json`. An encrypted
 * one at a destination opens only with a key `resolveStoredBackupKey` takes, whose AES-GCM tag
 * proves the file was made with it.
 */
export function isStoredEncrypted(fileName: string, meta: Record<string, unknown> | null): boolean {
    return storedAs(fileName, meta).encrypted;
}

/**
 * The key of a configuration backup at a destination. Its tag proves only that whoever made it held
 * the key, and a member of the home tenant may add a key of their own to the Vault. So it opens with
 * the key of the configuration backup, which only a platform admin picks, reveals or changes, or
 * with a key the admin picked or typed. Never with the one its `.meta.json` names, and no Smart
 * Recovery over the Vault.
 */
export async function resolveStoredBackupKey(request: KeyResolutionRequest & { verify: KeyVerifier }): Promise<Buffer> {
    if (request.override?.rawKeyHex || request.override?.profileId) return resolveBackupKey(request);
    const configKey = await getConfigBackupKeyId();
    if (configKey) {
        try {
            return await resolveBackupKey({ ...request, override: { profileId: configKey } });
        } catch (error: unknown) {
            if (!(error instanceof EncryptionKeyRequiredError)) throw error;
        }
    }
    // Without the key the file names, which whoever put it there chose, so the dialog never offers it.
    throw new EncryptionKeyRequiredError(NOT_CONFIG_BACKUP_KEY);
}

/**
 * Decrypts and unpacks a configuration backup into a temp file of its own, which the caller
 * removes. The key of an upload is the one given, the one its metadata names or one of the Vault,
 * the key of a file read from a destination one `resolveStoredBackupKey` takes. A missing key
 * throws EncryptionKeyRequiredError, which asks the person for one.
 */
export async function openBackupFile(file: string, meta: Record<string, unknown> | null, override?: KeyOverride, from: "upload" | "destination" = "upload"): Promise<string> {
    const how = storedAs(path.basename(file), meta);
    // Opened once the key is known, so a file whose key is refused leaves no stream open on it.
    const steps: Transform[] = [];

    if (how.encrypted) {
        if (!how.iv || !how.authTag) throw new ValidationError("The file is encrypted, and its .meta.json is missing. Pick it too.");
        const compression = how.compressed ? "GZIP" : undefined;
        const say = (message: string) => log.info(message);
        const key = from === "destination"
            ? await resolveStoredBackupKey({ profileId: how.profileId, override, verify: legacyStreamVerifier({ iv: how.iv, authTag: how.authTag }, file, compression), log: say })
            : await resolveDecryptionKey(
                { enabled: true, profileId: how.profileId ?? "", algorithm: "aes-256-gcm", iv: how.iv, authTag: how.authTag },
                file,
                compression,
                say,
                override
            );
        steps.push(createDecryptionStream(key, Buffer.from(how.iv, "hex"), Buffer.from(how.authTag, "hex")));
    }
    if (how.compressed) steps.push(createGunzip());
    const streams: (Readable | Transform)[] = [createReadStream(file), ...steps];

    // Decrypted, it holds every secret of the instance, so only DBackup reads it.
    const plain = await privateTempPath(`config_restore_${randomUUID()}`);
    try {
        await pipeline([...streams, createWriteStream(plain, { flags: "wx", mode: PRIVATE_FILE_MODE })]);
    } catch (error: unknown) {
        await fs.unlink(plain).catch(() => undefined);
        throw new ValidationError(`The file could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
    return plain;
}
