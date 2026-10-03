"use client";

import { useMemo, useState } from "react";
import { AddConnectionDialogs } from "@/components/adapter/add-connection-dialogs";
import { AdapterTiles } from "@/components/adapter/adapter-picker";
import { Button } from "@/components/ui/button";
import { ADAPTER_DEFINITIONS, type AdapterDefinition } from "@/lib/adapters/definitions";
import { STORAGE_ROLES, supportsStorageRole, type StorageRole } from "@/lib/core/storage-roles";
import { ExistingList, useExistingConnections } from "./existing-list";
import type { SetupEntry, SetupStep } from "./setup-model";
import { OpenSection } from "./setup-sections";

export type ConnectionStepId = "database" | "destination" | "notification";

interface ConnectionKind {
    /** The kind of connection the form adds. */
    type: "database" | "storage" | "notification";
    noun: string;
    plural: string;
    /** Where the connections of this kind that exist are listed. */
    url: string;
    offers: (adapter: AdapterDefinition) => boolean;
    /** Storage is added as a destination and nothing else. */
    role?: StorageRole;
}

const KINDS: Record<ConnectionStepId, ConnectionKind> = {
    database: {
        type: "database",
        noun: "database",
        plural: "databases",
        url: "/api/adapters?type=database",
        offers: (adapter) => adapter.type === "database",
    },
    destination: {
        type: "storage",
        noun: "destination",
        plural: "backup destinations",
        url: "/api/adapters?type=storage&role=DESTINATION",
        // A connection that can only be read from, like a container runtime, has no place here.
        offers: (adapter) => adapter.type === "storage" && supportsStorageRole(adapter.supportedRoles, STORAGE_ROLES.DESTINATION),
        role: STORAGE_ROLES.DESTINATION,
    },
    notification: {
        type: "notification",
        noun: "channel",
        plural: "notification channels",
        url: "/api/adapters?type=notification",
        offers: (adapter) => adapter.type === "notification",
    },
};

interface ConnectionStepProps {
    number: number;
    step: SetupStep & { id: ConnectionStepId };
    /** What the part holds already, when it is opened again. */
    picked: SetupEntry | null;
    /** Only an optional part can be skipped. */
    onSkip?: () => void;
    onDone: (entry: SetupEntry) => void;
}

/**
 * A part that picks a connection: the ones of this kind that exist, and the types to add a new
 * one. A type opens the form of the Connections page, and saving it finishes the part.
 */
export function ConnectionStep({ number, step, picked, onSkip, onDone }: ConnectionStepProps) {
    const kind = KINDS[step.id];
    const adapters = useMemo(() => ADAPTER_DEFINITIONS.filter(kind.offers), [kind]);
    const existing = useExistingConnections(kind.url);
    const [adding, setAdding] = useState<AdapterDefinition | null>(null);
    const [selected, setSelected] = useState<string | null>(picked?.id ?? null);
    const selectedEntry = existing?.find((entry) => entry.id === selected);
    const hasExisting = existing === null || existing.length > 0;

    return (
        <OpenSection
            number={number}
            step={step}
            actions={
                <>
                    {onSkip && (
                        <Button type="button" variant="ghost" onClick={onSkip}>
                            Skip
                        </Button>
                    )}
                    {hasExisting && (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={!selectedEntry}
                            onClick={() => selectedEntry && onDone({ id: selectedEntry.id, name: selectedEntry.name, adapterId: selectedEntry.adapterId })}
                        >
                            Use this {kind.noun}
                        </Button>
                    )}
                </>
            }
        >
            {hasExisting && (
                <div className="mb-5">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Use one you have</p>
                    <ExistingList entries={existing} value={selected} onValueChange={setSelected} label={`Your ${kind.plural}`} />
                </div>
            )}
            {hasExisting && <p className="mb-2 text-xs font-medium text-muted-foreground">Or add a new one</p>}
            <AdapterTiles adapters={adapters} onSelect={setAdding} />
            <AddConnectionDialogs
                open={adding !== null}
                onOpenChange={(open) => !open && setAdding(null)}
                type={kind.type}
                role={kind.role}
                title={`New ${kind.noun}`}
                start={adding}
                onSaved={(saved) => onDone({ id: saved.id, name: saved.name, adapterId: saved.adapterId })}
            />
        </OpenSection>
    );
}
