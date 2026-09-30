import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import type { RestorePreview } from "@/lib/types/config-backup";
import type { CopyKeys } from "./database-copy";

/** How long a checked backup waits for its Restore before it is thrown away. */
const WAIT_MS = 30 * 60 * 1000;

/** Who may restore it: the user who checked it, or the setup of a DBackup without any account. */
export type RestoreOwner = { userId: string } | "setup";

/** A backup that was opened and checked, waiting for the person to confirm its restore. */
export interface PendingRestore {
    /** The decrypted file in the temp folder. */
    file: string;
    fileName: string;
    preview: RestorePreview;
    keys: CopyKeys | null;
    owner: RestoreOwner;
    expiresAt: number;
}

/** On globalThis, since every bundle of Next.js loads this module anew. */
const globalForRestores = globalThis as unknown as { pendingConfigRestores?: Map<string, PendingRestore> };
const pending = (globalForRestores.pendingConfigRestores ??= new Map<string, PendingRestore>());

const sameOwner = (a: RestoreOwner, b: RestoreOwner) => (a === "setup" || b === "setup" ? a === b : a.userId === b.userId);

/** Removes what waited too long, with its file. */
async function sweep(now = Date.now()): Promise<void> {
    for (const [token, entry] of pending) {
        if (entry.expiresAt > now) continue;
        pending.delete(token);
        await fs.unlink(entry.file).catch(() => undefined);
    }
}

/** Holds a checked backup until its restore is confirmed, and answers with the token that confirms it. */
export async function holdRestore(entry: Omit<PendingRestore, "expiresAt">): Promise<string> {
    await sweep();
    const token = randomUUID();
    pending.set(token, { ...entry, expiresAt: Date.now() + WAIT_MS });
    return token;
}

/** A held backup without handing it out, to check it before its restore starts. */
export async function peekRestore(token: string, owner: RestoreOwner): Promise<PendingRestore | null> {
    await sweep();
    const entry = pending.get(token);
    return entry && sameOwner(entry.owner, owner) ? entry : null;
}

/** Hands a held backup out once, to whoever checked it. Null when it is gone or belongs to someone else. */
export async function takeRestore(token: string, owner: RestoreOwner): Promise<PendingRestore | null> {
    await sweep();
    const entry = pending.get(token);
    if (!entry || !sameOwner(entry.owner, owner)) return null;
    pending.delete(token);
    return entry;
}
