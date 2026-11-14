"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";
import { Fingerprint, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { DateDisplay } from "@/components/utils/date-display";
import { forgetSshHostKey, trustSshHostKey } from "@/app/actions/adapter/ssh-host-key";
import { sshEndpointOf, VERIFY_HOST_KEY, verifiesHostKey } from "@/lib/transport/ssh-endpoint";
import { parseMetadata, pinFor } from "@/lib/adapters/ssh-host-key-pins";
import type { ConnectionTestState } from "./use-connection-form";

/**
 * The switch that turns the host key check of an SSH login off. A config without the value, like
 * one saved before the switch existed, checks, so it shows on.
 */
export function HostKeySwitch() {
    const { control } = useFormContext();
    return (
        <FormField
            control={control}
            name={`config.${VERIFY_HOST_KEY}`}
            render={({ field }) => (
                <FormItem className="flex items-center gap-4 rounded-lg border px-4 py-3">
                    <div className="grid min-w-0 flex-1 gap-0.5">
                        <FormLabel>Check the host key</FormLabel>
                        <p className="text-xs text-muted-foreground">
                            DBackup pins the key of this SSH server on the first connect and refuses a server that presents another one.
                            With the check off it accepts every key, so whoever answers for this address can receive the login and the backups.
                        </p>
                    </div>
                    <FormControl>
                        <Switch checked={field.value !== false} onCheckedChange={field.onChange} />
                    </FormControl>
                </FormItem>
            )}
        />
    );
}

interface HostKeyStripProps {
    adapterId: string;
    /** The config as the form holds it. */
    config: Record<string, unknown>;
    /** The saved connection being edited, none while one is added. */
    saved?: { id: string; metadata?: string | null };
    test: ConnectionTestState;
    /** Hides Forget and Trust, for a connection that opens read-only. */
    readOnly: boolean;
    /** After a new key was trusted, so the failed test no longer stands. */
    onTrusted: () => void;
}

/** What the strip knows of the pin beyond the metadata the form was opened with. */
type LocalPin = { fingerprint: string; pinnedAt: string | null } | null | undefined;

const mono = "font-mono text-xs break-all";

/**
 * The line above the buttons of the connection form about the host key of the SSH server: the
 * pinned key with Forget, the key a test just saw, or a changed key with Trust the new key.
 * Nothing for a connection without an SSH login or with the check switched off.
 */
export function HostKeyStrip({ adapterId, config, saved, test, readOnly, onTrusted }: HostKeyStripProps) {
    // Undefined until Forget or Trust changed the pin in this form, then what it is now.
    const [local, setLocal] = useState<LocalPin>(undefined);
    const [busy, setBusy] = useState(false);

    const endpoint = sshEndpointOf(adapterId, config);
    if (!endpoint || !verifiesHostKey(config)) return null;

    const stored = saved ? pinFor(parseMetadata(saved.metadata), endpoint) : null;
    // A passing test of a saved connection without a pin pinned the key it saw.
    const tested = test.status === "passed" ? test.hostKey : undefined;
    const pinned = local !== undefined
        ? local
        : stored ? { fingerprint: stored.fingerprint, pinnedAt: stored.pinnedAt || null }
        : saved && tested ? { fingerprint: tested.fingerprint, pinnedAt: null }
        : null;
    const mismatch = test.status === "failed" ? test.hostKeyMismatch : undefined;

    const trust = async (fingerprint: string) => {
        if (!saved) return;
        setBusy(true);
        try {
            const result = await trustSshHostKey(saved.id, fingerprint);
            if (result.success) {
                setLocal({ fingerprint, pinnedAt: new Date().toISOString() });
                onTrusted();
                toast.success("The new key is trusted");
            } else toast.error(result.error);
        } catch {
            toast.error("The key could not be trusted.");
        } finally {
            setBusy(false);
        }
    };

    const forget = async () => {
        if (!saved) return;
        setBusy(true);
        try {
            const result = await forgetSshHostKey(saved.id);
            if (result.success) {
                setLocal(null);
                toast.success("The key is forgotten. The next connect pins the key it sees.");
            } else toast.error(result.error);
        } catch {
            toast.error("The key could not be forgotten.");
        } finally {
            setBusy(false);
        }
    };

    if (mismatch) {
        return (
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-warning/30 bg-warning/5 px-5 py-3 text-sm" role="alert">
                <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
                <div className="grid min-w-0 flex-1 basis-64 gap-0.5">
                    <p className="font-medium">The server presents another host key</p>
                    <p className="text-xs text-muted-foreground">
                        Nothing was sent to it. Trust the new key only when you know why it changed, like after a reinstall of the server.
                    </p>
                    <p className={mono}>Trusted: {mismatch.expected}</p>
                    <p className={mono}>Presented: {mismatch.presented ?? "not reported, test the connection again"}</p>
                </div>
                {saved && mismatch.presented && !readOnly && (
                    <Button type="button" variant="outline" size="sm" tone="warning" disabled={busy} onClick={() => trust(mismatch.presented!)}>
                        {busy && <Loader2 className="animate-spin" />}
                        Trust the new key
                    </Button>
                )}
            </div>
        );
    }

    return (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-5 py-2.5 text-xs text-muted-foreground">
            <Fingerprint className="size-3.5 shrink-0" aria-hidden="true" />
            {pinned ? (
                <>
                    <p className="min-w-0 flex-1 basis-64">
                        Server key <span className={mono}>{pinned.fingerprint}</span>
                        {pinned.pinnedAt ? <>, pinned <DateDisplay date={pinned.pinnedAt} /></> : ", pinned by this test"}
                    </p>
                    {saved && !readOnly && (
                        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={forget}>
                            {busy && <Loader2 className="animate-spin" />}
                            Forget
                        </Button>
                    )}
                </>
            ) : tested ? (
                <p className="min-w-0 flex-1">
                    Server key <span className={mono}>{tested.fingerprint}</span> will be trusted for this connection once it is saved.
                </p>
            ) : (
                <p className="min-w-0 flex-1">No server key is pinned yet. The first successful connect pins the key it sees.</p>
            )}
        </div>
    );
}
