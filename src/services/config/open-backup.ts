import { createReadStream, createWriteStream, promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import type { Readable, Transform } from "stream";
import { createGunzip } from "zlib";
import { createDecryptionStream } from "@/lib/crypto/stream";
import { getTempDir } from "@/lib/temp-dir";
import { logger } from "@/lib/logging/logger";
import { ValidationError } from "@/lib/logging/errors";
import type { KeyOverride } from "@/services/backup/key-resolution";
import { resolveDecryptionKey } from "@/services/restore/smart-recovery";

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

/**
 * Decrypts and unpacks a configuration backup into a temp file of its own, which the caller
 * removes. The key is the one given, the one its metadata names or one of the Vault. A missing
 * key throws EncryptionKeyRequiredError, which asks the person for one.
 */
export async function openBackupFile(file: string, meta: Record<string, unknown> | null, override?: KeyOverride): Promise<string> {
    const how = storedAs(path.basename(file), meta);
    const streams: (Readable | Transform)[] = [createReadStream(file)];

    if (how.encrypted) {
        if (!how.iv || !how.authTag) throw new ValidationError("The file is encrypted, and its .meta.json is missing. Pick it too.");
        const key = await resolveDecryptionKey(
            { enabled: true, profileId: how.profileId ?? "", algorithm: "aes-256-gcm", iv: how.iv, authTag: how.authTag },
            file,
            how.compressed ? "GZIP" : undefined,
            (message) => log.info(message),
            override
        );
        streams.push(createDecryptionStream(key, Buffer.from(how.iv, "hex"), Buffer.from(how.authTag, "hex")));
    }
    if (how.compressed) streams.push(createGunzip());

    const plain = path.join(getTempDir(), `config_restore_${randomUUID()}`);
    try {
        await pipeline([...streams, createWriteStream(plain)]);
    } catch (error: unknown) {
        await fs.unlink(plain).catch(() => undefined);
        throw new ValidationError(`The file could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
    return plain;
}
