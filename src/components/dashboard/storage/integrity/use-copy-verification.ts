"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { CopyCheck, CopyVerification } from "@/services/storage/copy-verification";

/** How often a running check is asked where it stands. */
const POLL_MS = 1500;

const done = (status: string) => status !== "Pending" && status !== "Running";

/**
 * Starts a check of copies on the server and follows it until it ends. The check goes on when
 * the dialog closes, the dialog only stops asking.
 */
export function useCopyVerification(onFinished: (result: CopyVerification) => void) {
    const [run, setRun] = useState<CopyVerification | null>(null);
    const [starting, setStarting] = useState(false);
    const finished = useRef(onFinished);
    useEffect(() => {
        finished.current = onFinished;
    }, [onFinished]);

    const start = async (copies: { destinationId: string; file: string }[]) => {
        setStarting(true);
        try {
            const res = await fetch("/api/storage/verify-copies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ copies }),
            });
            const data: { success?: boolean; data?: { executionId?: string }; error?: string } = await res.json().catch(() => ({}));
            const executionId = data.data?.executionId;
            if (!res.ok || !executionId) {
                toast.error(data.error ?? "The check could not start");
                return;
            }
            setRun({ executionId, status: "Pending", progress: 0, copies: copies.map((copy) => ({ ...copy, state: "waiting" as const })) });
        } catch {
            toast.error("The check could not start");
        } finally {
            setStarting(false);
        }
    };

    const executionId = run && !done(run.status) ? run.executionId : null;
    useEffect(() => {
        if (!executionId) return;
        const timer = setInterval(async () => {
            try {
                const res = await fetch(`/api/storage/verify-copies?executionId=${encodeURIComponent(executionId)}`);
                const data: { data?: CopyVerification } = await res.json().catch(() => ({}));
                const next = data.data;
                if (!res.ok || !next) return;
                setRun(next);
                if (done(next.status)) finished.current(next);
            } catch {
                // The next round asks again.
            }
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [executionId]);

    const live = new Map<string, CopyCheck>((run?.copies ?? []).map((check) => [check.destinationId, check]));
    return { run, running: !!executionId || starting, starting, live, start };
}
