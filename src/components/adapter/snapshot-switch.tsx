"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Shadow copy toggle for a directory source.
 *
 * The switch cannot be turned on until the server has confirmed it can deliver one -
 * enabling it blind would configure a job that fails on its next run, because a backup
 * relying on snapshots is aborted rather than quietly taken without one.
 */
export function SnapshotSwitch({ enabled, onChange, adapterId, getConfig }: {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    adapterId: string;
    getConfig: () => { config: Record<string, unknown>; primaryCredentialId: string | null; sshCredentialId: string | null };
}) {
    const id = useId();
    const [checking, setChecking] = useState(false);
    // Null until checked in this session. An already-enabled adapter was verified when it
    // was saved, so it stays on without re-checking every time the form opens.
    const [available, setAvailable] = useState<boolean | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const runCheck = async () => {
        setChecking(true);
        setMessage(null);
        try {
            const { config, primaryCredentialId, sshCredentialId } = getConfig();
            const res = await fetch("/api/adapters/check-snapshot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ adapterId, config, primaryCredentialId, sshCredentialId }),
            });
            const data = await res.json();
            setAvailable(!!data.supported);
            setMessage(data.message ?? null);
            if (!data.supported) onChange(false);
        } catch (error: unknown) {
            setAvailable(false);
            setMessage(error instanceof Error ? error.message : "The check could not be run.");
            onChange(false);
        } finally {
            setChecking(false);
        }
    };

    const canEnable = enabled || available === true;

    return (
        <div className="grid gap-3 rounded-lg border px-4 py-3">
            <div className="flex items-center gap-4">
                <div className="grid min-w-0 flex-1 gap-0.5">
                    <Label htmlFor={id}>Read from a shadow copy (VSS)</Label>
                    <p className="text-xs text-muted-foreground">
                        Asks the file server for a point-in-time snapshot and backs that up instead of the live share, so open
                        files can be read and the backup reflects a single moment. Needs Windows Server 2012 or newer with the
                        File Server VSS Agent Service, or Samba 4.2+, and an account with backup privileges.
                    </p>
                </div>
                <Switch id={id} checked={enabled} disabled={!canEnable} onCheckedChange={onChange} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" size="sm" onClick={runCheck} disabled={checking}>
                    {checking && <Loader2 className="animate-spin" />}
                    Check availability
                </Button>
                {available === null && !enabled && <span className="text-xs text-muted-foreground">Run the check to turn this on.</span>}
            </div>
            {message && <p className={cn("text-xs", available ? "text-muted-foreground" : "text-warning")}>{message}</p>}
        </div>
    );
}
