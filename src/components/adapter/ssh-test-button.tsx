"use client";

import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";
import { CircleCheck, Loader2, TriangleAlert, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

type SshTestState = "idle" | "running" | "passed" | "failed";

/**
 * Logs into the SSH server alone, before the database behind it is involved.
 *
 * The result stays beside the button until a field changes, since it only speaks for the
 * values it was run with. A failure also goes to a toast, where its message has room.
 */
export function SshTestButton({ adapterId, sshCredentialId }: { adapterId: string; sshCredentialId: string | null }) {
    const { getValues, watch } = useFormContext();
    // The profile a result was reached with. A different one is a different login, so the
    // result no longer holds once the profile changes.
    const [result, setResult] = useState<{ state: SshTestState; credentialId: string | null }>({ state: "idle", credentialId: null });
    const state: SshTestState = result.credentialId === sshCredentialId ? result.state : "idle";
    const setState = (next: SshTestState) => setResult({ state: next, credentialId: sshCredentialId });

    useEffect(() => {
        const subscription = watch(() => setResult((current) => (current.state === "running" ? current : { ...current, state: "idle" })));
        return () => subscription.unsubscribe();
    }, [watch]);

    const run = async () => {
        setState("running");
        try {
            const res = await fetch("/api/adapters/test-ssh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ config: getValues("config"), adapterId, sshCredentialId }),
            });
            const result = await res.json();
            if (result.success) {
                setState("passed");
            } else {
                setState("failed");
                toast.error(result.message || "SSH connection failed");
            }
        } catch {
            setState("failed");
            toast.error("Failed to test the SSH connection");
        }
    };

    return (
        <div className="flex shrink-0 items-center gap-2.5">
            {state === "passed" && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-success">
                    <CircleCheck className="size-3.5" aria-hidden="true" />
                    Login works
                </span>
            )}
            {state === "failed" && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
                    <TriangleAlert className="size-3.5" aria-hidden="true" />
                    Failed
                </span>
            )}
            <Button type="button" variant="outline" size="sm" onClick={run} disabled={state === "running"}>
                {state === "running" ? <Loader2 className="animate-spin" /> : <Zap />}
                Test SSH
            </Button>
        </div>
    );
}
