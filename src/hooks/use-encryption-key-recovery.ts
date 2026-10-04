"use client";

import { useCallback, useRef, useState } from "react";
import type { KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";

/** What the key dialog says when a key that was tried does not open the backup and the server named no reason. */
export const WRONG_KEY = "That key does not open this backup.";

/** Request fields that tell the server which key to open a backup with. */
export interface KeyOverrideBody {
    profileIdOverride?: string;
}

/**
 * Turns the dialog's answer into the fields a request carries.
 *
 * Only ever a profile id. A typed key is checked and imported into the vault before it gets
 * here, so it arrives as the profile it became and no raw key is ever put on the wire by
 * these flows.
 */
export function keyOverrideBody(result?: KeyResolutionResult | null): KeyOverrideBody {
    return result?.type === "profile" ? { profileIdOverride: result.profileId } : {};
}

/**
 * Client half of the key-required contract.
 *
 * Any request that opens an encrypted backup can come back with 422 and
 * `code: "ENCRYPTION_KEY_REQUIRED"`. The answer is always the same - ask for a key, then do
 * the same thing again - so it lives here once rather than being rebuilt in the storage
 * explorer, the restore page and the settings page.
 *
 * Two things make this more than a dialog toggle:
 *
 * - The answer belongs to the whole page, not to the one request that happened to ask.
 *   Opening a backup takes several requests (analyse, browse each folder, dry run, restore),
 *   and every one of them needs the same key. `override` carries it, and callers spread it
 *   into their request bodies.
 * - A retry can hit the same wall. Choosing a profile that turns out not to fit must say so
 *   and leave the dialog up, not close it as though it had worked.
 */
export function useEncryptionKeyRecovery() {
    const [open, setOpen] = useState(false);
    const [profileIdHint, setProfileIdHint] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [override, setOverride] = useState<KeyOverrideBody | undefined>(undefined);

    const retryRef = useRef<((result: KeyResolutionResult) => void | Promise<void>) | null>(null);
    /** Counts key prompts, so a retry that produced another one can be told apart. */
    const promptCount = useRef(0);
    const lastMessage = useRef("");

    /**
     * Checks whether a response is asking for a key.
     *
     * @param response - The response to inspect. Read through a clone, so the caller's own
     * handling of the body is unaffected.
     * @param retry - Run once the user has supplied a key, with their answer.
     * @returns true when the dialog has taken over and the caller should stop here.
     */
    const intercept = useCallback(async (
        response: Response,
        retry: (result: KeyResolutionResult) => void | Promise<void>
    ): Promise<boolean> => {
        if (response.status !== 422) return false;

        const payload: { code?: string; profileId?: string; error?: string } =
            await response.clone().json().catch(() => ({}));
        if (payload.code !== "ENCRYPTION_KEY_REQUIRED") return false;

        promptCount.current += 1;
        lastMessage.current = payload.error ?? "";
        retryRef.current = retry;
        setProfileIdHint(payload.profileId ?? "");
        setOpen(true);
        return true;
    }, []);

    const onConfirm = useCallback(async (result: KeyResolutionResult) => {
        const retry = retryRef.current;
        if (!retry) return;

        const promptsBefore = promptCount.current;
        setLoading(true);
        setError("");
        try {
            await retry(result);

            if (promptCount.current > promptsBefore) {
                // The retry ran into the same wall. Closing here would look like success.
                setError(lastMessage.current || WRONG_KEY);
                return;
            }

            // Remembered for every later request of this page - the one that asked is
            // rarely the last one that needs it.
            setOverride(keyOverrideBody(result));
            setOpen(false);
            retryRef.current = null;
        } catch (e: unknown) {
            // Swallowed rather than rethrown: the dialog does not await this, so an escaping
            // rejection would go unhandled.
            setError(e instanceof Error ? e.message : "That key did not work.");
        } finally {
            setLoading(false);
        }
    }, []);

    const onOpenChange = useCallback((next: boolean) => {
        setOpen(next);
        if (!next) {
            retryRef.current = null;
            setProfileIdHint("");
            setError("");
        }
    }, []);

    return { open, profileIdHint, loading, error, override, intercept, onConfirm, onOpenChange };
}
