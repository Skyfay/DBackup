"use client";

import { useEffect, useId, useState } from "react";
import { KeyRound } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { connectionAddress } from "@/components/adapter/connection-summary";
import type { AdapterConfig } from "@/components/adapter/types";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "SetupExistingList" });

/** A connection or a key that exists already, as a step offers it. */
export interface ExistingEntry {
    id: string;
    name: string;
    /** What it is and where it points, "MySQL · db01.internal:3306". */
    detail: string;
    /** The adapter of a connection. A key has none. */
    adapterId?: string;
}

function toEntry(config: AdapterConfig): ExistingEntry {
    const type = getAdapterDefinition(config.adapterId)?.name ?? config.adapterId;
    const address = connectionAddress(config.adapterId, config.config);
    return { id: config.id, name: config.name, adapterId: config.adapterId, detail: address ? `${type} · ${address}` : type };
}

/**
 * The connections a list url returns, null while they load. A list that cannot be loaded, like one
 * the user may not read, counts as empty, so the step simply offers nothing to pick.
 */
export function useExistingConnections(url: string): ExistingEntry[] | null {
    const [entries, setEntries] = useState<ExistingEntry[] | null>(null);

    useEffect(() => {
        let active = true;
        fetch(url)
            .then((res) => (res.ok ? res.json() : []))
            .then((items: unknown) => {
                if (active) setEntries(Array.isArray(items) ? (items as AdapterConfig[]).map(toEntry) : []);
            })
            .catch((error: unknown) => {
                log.warn("Existing connections could not be loaded", { url }, wrapError(error));
                if (active) setEntries([]);
            });
        return () => {
            active = false;
        };
    }, [url]);

    return entries;
}

interface ExistingListProps {
    entries: ExistingEntry[] | null;
    value: string | null;
    onValueChange: (id: string) => void;
    /** Names the list for a screen reader, like "Your databases". */
    label: string;
}

/**
 * The entries to pick from, one row each. A click marks a row in the tone of picking, and the
 * button in the footer takes it, the way the file browser works.
 */
export function ExistingList({ entries, value, onValueChange, label }: ExistingListProps) {
    const id = useId();

    if (entries === null) {
        return (
            <div className="grid gap-1" aria-busy="true">
                {[0, 1, 2].map((row) => (
                    <div key={row} className="flex items-center gap-3 px-2.5 py-2">
                        <Skeleton className="size-9 rounded-lg" />
                        <div className="grid flex-1 gap-1.5">
                            <Skeleton className="h-3.5 w-40" />
                            <Skeleton className="h-3 w-56" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <RadioGroup value={value ?? ""} onValueChange={onValueChange} aria-label={label} className="gap-1">
            {entries.map((entry) => (
                <Label
                    key={entry.id}
                    htmlFor={`${id}-${entry.id}`}
                    className="cursor-pointer gap-3 rounded-lg border border-transparent px-2.5 py-2 leading-normal font-normal transition-colors hover:bg-muted/50 has-data-[state=checked]:border-tone-control/60 has-data-[state=checked]:bg-tone-control/5 dark:has-data-[state=checked]:bg-tone-control/10"
                >
                    <RadioGroupItem id={`${id}-${entry.id}`} value={entry.id} className="shrink-0" />
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                        {entry.adapterId ? <AdapterIcon adapterId={entry.adapterId} className="size-4.5" /> : <KeyRound className="size-4 text-muted-foreground" />}
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate text-sm font-medium">{entry.name}</span>
                        {entry.detail && <span className="truncate text-xs text-muted-foreground">{entry.detail}</span>}
                    </span>
                </Label>
            ))}
        </RadioGroup>
    );
}
