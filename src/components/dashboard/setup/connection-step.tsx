"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { AdapterPicker } from "@/components/adapter/adapter-picker";
import { ConnectionForm } from "@/components/adapter/connection-form";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ADAPTER_DEFINITIONS, type AdapterDefinition } from "@/lib/adapters/definitions";
import { STORAGE_ROLES, supportsStorageRole, type StorageRole } from "@/lib/core/storage-roles";
import { ExistingList, useExistingConnections } from "./existing-list";
import type { SetupEntry, SetupStep } from "./setup-model";
import { BackButton, StepFrame } from "./step-frame";

export type ConnectionStepId = "database" | "destination" | "notification";

interface ConnectionKind {
    question: string;
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
        question: "What do you want to back up?",
        noun: "database",
        plural: "databases",
        url: "/api/adapters?type=database",
        offers: (adapter) => adapter.type === "database",
    },
    destination: {
        question: "Where should the backups go?",
        noun: "destination",
        plural: "backup destinations",
        url: "/api/adapters?type=storage&role=DESTINATION",
        // A connection that can only be read from, like a container runtime, has no place here.
        offers: (adapter) => adapter.type === "storage" && supportsStorageRole(adapter.supportedRoles, STORAGE_ROLES.DESTINATION),
        role: STORAGE_ROLES.DESTINATION,
    },
    notification: {
        question: "Where should DBackup report the runs?",
        noun: "channel",
        plural: "notification channels",
        url: "/api/adapters?type=notification",
        offers: (adapter) => adapter.type === "notification",
    },
};

interface ConnectionStepProps {
    step: SetupStep & { id: ConnectionStepId };
    /** "Step 1 of 5" */
    position: string;
    /** What the step holds already, when it is opened again. */
    picked: SetupEntry | null;
    onBack?: () => void;
    /** Only an optional step can be skipped. */
    onSkip?: () => void;
    onDone: (entry: SetupEntry) => void;
}

/**
 * A step that adds a connection: the list of types, then the connection form of the Connections
 * page, and on to the next step as soon as it is saved. Whoever has connections of this kind can
 * pick one of those instead.
 */
export function ConnectionStep({ step, position, picked, onBack, onSkip, onDone }: ConnectionStepProps) {
    const kind = KINDS[step.id];
    const adapters = useMemo(() => ADAPTER_DEFINITIONS.filter(kind.offers), [kind]);
    const existing = useExistingConnections(kind.url);
    const [view, setView] = useState<"types" | "existing">(picked ? "existing" : "types");
    const [adapter, setAdapter] = useState<AdapterDefinition | null>(null);
    const [selected, setSelected] = useState<string | null>(picked?.id ?? null);
    const selectedEntry = existing?.find((entry) => entry.id === selected);
    const back = onBack && <BackButton onClick={onBack} />;
    const skip = onSkip && (
        <Button type="button" variant="outline" onClick={onSkip}>
            Skip
        </Button>
    );

    if (adapter) {
        return (
            <ConnectionForm
                container="page"
                adapter={adapter}
                defaultRole={kind.role}
                lockRole={!!kind.role}
                step={position}
                onBack={() => setAdapter(null)}
                onSaved={(saved) => {
                    if (saved) onDone(saved);
                    else toast.error("The setup could not go on with the new connection. Pick it under Use existing.");
                }}
            />
        );
    }

    if (view === "existing") {
        return (
            <StepFrame
                tone="pick"
                icon={step.icon}
                title={step.title}
                note={`Pick one you already have · ${position}`}
                start={back}
                end={
                    <>
                        <Button type="button" variant="outline" onClick={() => setView("types")}>
                            <Plus />
                            New {kind.noun}
                        </Button>
                        {skip}
                        <Button
                            type="button"
                            disabled={!selectedEntry}
                            onClick={() => selectedEntry && onDone({ id: selectedEntry.id, name: selectedEntry.name, adapterId: selectedEntry.adapterId })}
                        >
                            Use this {kind.noun}
                        </Button>
                    </>
                }
            >
                <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
                    <div className="p-3">
                        {existing?.length === 0 ? (
                            <p className="px-2 py-6 text-center text-sm text-muted-foreground">There are no {kind.plural} yet.</p>
                        ) : (
                            <ExistingList entries={existing} value={selected} onValueChange={setSelected} label={`Your ${kind.plural}`} />
                        )}
                    </div>
                </ScrollArea>
            </StepFrame>
        );
    }

    return (
        <StepFrame
            tone="create"
            icon={step.icon}
            title={step.title}
            note={`${kind.question} · ${position}`}
            start={back}
            end={
                <>
                    {existing && existing.length > 0 && (
                        <Button type="button" variant="outline" onClick={() => setView("existing")}>
                            Use existing
                        </Button>
                    )}
                    {skip}
                </>
            }
        >
            <AdapterPicker adapters={adapters} onSelect={setAdapter} />
        </StepFrame>
    );
}
