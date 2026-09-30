"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

type RestartState = "waiting" | "stuck";

/** How long DBackup may take to go down and to come back before the page says it did not. */
const DOWN_WITHIN_MS = 60_000;
const BACK_WITHIN_MS = 180_000;

/**
 * Watches `/api/health` while DBackup restarts for a configuration restore: it has to go down
 * first and then answer again, then the sign-in page opens, since every sign-in ended with the
 * restore.
 */
function useRestartWait(): RestartState {
    const [state, setState] = useState<RestartState>("waiting");

    useEffect(() => {
        const started = Date.now();
        let wentDown = false;
        let stopped = false;
        const check = async () => {
            if (stopped) return;
            let healthy = false;
            try {
                healthy = (await fetch("/api/health", { cache: "no-store" })).ok;
            } catch {
                healthy = false;
            }
            if (!healthy) wentDown = true;
            if (wentDown && healthy) {
                // A full load: the session ended with the restore, so the page sends the person to sign in.
                window.location.reload();
                return;
            }
            const waited = Date.now() - started;
            if ((!wentDown && waited > DOWN_WITHIN_MS) || waited > BACK_WITHIN_MS) setState("stuck");
            setTimeout(() => void check(), 2000);
        };
        setTimeout(() => void check(), 2000);
        return () => {
            stopped = true;
        };
    }, []);

    return state;
}

/** Stands in for a restore while DBackup restarts, and opens the sign-in page once it is back. */
export function RestartWait() {
    const state = useRestartWait();
    const stuck = state === "stuck";
    return (
        <div className="flex flex-col items-center gap-3 px-5 py-10 text-center" role="status" aria-live="polite">
            {stuck ? <AlertTriangle className="size-6 text-warning" aria-hidden="true" /> : <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />}
            <p className="font-semibold">{stuck ? "DBackup did not come back by itself" : "DBackup restarts with the restored database"}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
                {stuck
                    ? "Start its container again, the restore waits for that. Without a restart policy like always, Docker leaves it stopped."
                    : "This takes about a minute. The sign-in page opens by itself, sign in there with an account of the backup."}
            </p>
        </div>
    );
}
