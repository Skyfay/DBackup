/**
 * The fields that joined `SENSITIVE_KEYS` after earlier versions had stored them as plain text,
 * like the extra headers of a Generic Webhook, which carry API keys. At every start this encrypts
 * each value of them that is still plain, in the connections and in the connections waiting in
 * Recently deleted, so a configuration restore of an older copy is covered by the start that
 * follows it.
 *
 * Only these fields are walked, since every value of them that is no ciphertext is known to be
 * plain. `decrypt` takes a value of three `:` parts for ciphertext, so a plain header like
 * `X-A: b:c` would fail to open until it is encrypted here. Whatever fails stays for the next start.
 */

import prisma from "@/lib/prisma";
import { encrypt, isSealed } from "@/lib/crypto";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ module: "SealPlainSecrets" });

/** The fields earlier versions stored as plain text. */
const ONCE_PLAIN_KEYS = ["customHeaders"] as const;

type Config = Record<string, unknown>;

/** The config of a connection with these fields encrypted, null when none of them was plain. */
export function sealConfig(json: string): string | null {
    let config: unknown;
    try {
        config = JSON.parse(json);
    } catch {
        return null;
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) return null;
    const next: Config = { ...(config as Config) };
    let changed = false;
    for (const key of ONCE_PLAIN_KEYS) {
        const value = next[key];
        if (typeof value === "string" && value !== "" && !isSealed(value)) {
            next[key] = encrypt(value);
            changed = true;
        }
    }
    return changed ? JSON.stringify(next) : null;
}

/** The snapshot of a connection in Recently deleted with its config sealed, null when nothing changed. */
export function sealSnapshot(json: string): string | null {
    let snapshot: { record?: { config?: unknown } };
    try {
        snapshot = JSON.parse(json);
    } catch {
        return null;
    }
    const config = snapshot?.record?.config;
    if (typeof config !== "string") return null;
    const sealed = sealConfig(config);
    if (!sealed) return null;
    return JSON.stringify({ ...snapshot, record: { ...snapshot.record, config: sealed } });
}

/** Encrypts every plain value of `ONCE_PLAIN_KEYS`. Never throws, a failure is logged. */
export async function sealPlainSecrets(): Promise<void> {
    try {
        const match = ONCE_PLAIN_KEYS.map((key) => ({ config: { contains: `"${key}"` } }));
        const rows = await prisma.adapterConfig.findMany({ where: { OR: match }, select: { id: true, config: true } });
        let sealed = 0;
        for (const row of rows) {
            const config = sealConfig(row.config);
            if (!config) continue;
            await prisma.adapterConfig.update({ where: { id: row.id }, data: { config } });
            sealed++;
        }

        const deleted = await prisma.deletedRecord.findMany({
            where: { kind: "connection", OR: ONCE_PLAIN_KEYS.map((key) => ({ data: { contains: key } })) },
            select: { id: true, data: true },
        });
        for (const row of deleted) {
            const data = sealSnapshot(row.data);
            if (!data) continue;
            await prisma.deletedRecord.update({ where: { id: row.id }, data: { data } });
            sealed++;
        }

        if (sealed > 0) log.info("Encrypted secrets that earlier versions stored as plain text", { sealed });
    } catch (error) {
        log.error("Encrypting the plain secrets of earlier versions failed", {}, wrapError(error));
    }
}
