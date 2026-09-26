"use client";

import { ShieldCheck, XCircle } from "lucide-react";
import { ConnectionPicker } from "@/components/dashboard/jobs/connection-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Section } from "./restore-parts";
import type { RestoreDatabases } from "./use-restore-databases";

/**
 * The server the databases go to: only servers of the kind of the backup, each with its logo, and
 * whether its version can take the backup. A newer backup on an older server is turned down here
 * already, since the server would turn it down too.
 */
export function DatabaseTarget({ databases }: { databases: RestoreDatabases }) {
    const { engine, options, target, setTarget, loadingServer, compatibility, connectionsLoaded } = databases;
    return (
        <Section title="Restore into" note={`A ${engine} server of your connections. Only servers of the same kind are offered.`}>
            <div className="max-w-xl">
                <ConnectionPicker kind="database" options={options} value={target} onChange={setTarget} placeholder={`Pick a ${engine} server`} aria-label="Server to restore into" />
            </div>
            {target && loadingServer && <Skeleton className="mt-3 h-4 w-72" />}
            {target && !loadingServer && compatibility && (
                <p className={cn("mt-3 flex items-start gap-2 text-sm", compatibility.ok ? "text-foreground" : "text-destructive")}>
                    {compatibility.ok ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                    {compatibility.text}
                </p>
            )}
            {connectionsLoaded && options.length === 0 && (
                <p className="mt-3 text-sm text-muted-foreground">
                    There is no {engine} server in your connections yet. The list above adds one with New.
                </p>
            )}
        </Section>
    );
}
