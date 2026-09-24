"use client";

import { useId, useState } from "react";
import { KeyRound, Loader2, Plus, ShieldCheck, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { createEncryptionProfile } from "@/app/actions/backup/encryption";
import { freeKeyName } from "@/components/settings/encryption-key-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ExistingList, type ExistingEntry } from "./existing-list";
import type { SetupEntry, SetupStep } from "./setup-model";
import { BackButton, StepFrame } from "./step-frame";

function Fact({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
    return (
        <li className="flex gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
                <Icon className="size-4" />
            </span>
            <span className="pt-1.5 text-sm text-muted-foreground">{children}</span>
        </li>
    );
}

interface EncryptionStepProps {
    step: SetupStep;
    position: string;
    /** The keys in the Vault, the ones made during the setup included. */
    keys: ExistingEntry[];
    picked: SetupEntry | null;
    onBack: () => void;
    onSkip: () => void;
    onDone: (entry: SetupEntry) => void;
}

/** A key for the backups, made here or picked from the Vault. The step can be skipped. */
export function EncryptionStep({ step, position, keys, picked, onBack, onSkip, onDone }: EncryptionStepProps) {
    const nameId = useId();
    const [view, setView] = useState<"create" | "existing">(picked ? "existing" : "create");
    const [name, setName] = useState(() => freeKeyName(keys.map((key) => key.name)));
    const [creating, setCreating] = useState(false);
    const [selected, setSelected] = useState<string | null>(picked?.id ?? null);
    const selectedKey = keys.find((key) => key.id === selected);
    const skip = (
        <Button type="button" variant="outline" onClick={onSkip}>
            Skip
        </Button>
    );

    const create = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        setCreating(true);
        try {
            const result = await createEncryptionProfile(trimmed);
            if (result.success && result.data) {
                toast.success("Key created");
                onDone({ id: result.data.id, name: trimmed });
                return;
            }
            toast.error(result.error || "The key could not be created.");
        } catch {
            toast.error("The key could not be created.");
        }
        setCreating(false);
    };

    if (view === "existing") {
        return (
            <StepFrame
                tone="pick"
                icon={step.icon}
                title={step.title}
                note={`Pick a key from the Vault · ${position}`}
                start={<BackButton onClick={onBack} />}
                end={
                    <>
                        <Button type="button" variant="outline" onClick={() => setView("create")}>
                            <Plus />
                            New key
                        </Button>
                        {skip}
                        <Button type="button" disabled={!selectedKey} onClick={() => selectedKey && onDone({ id: selectedKey.id, name: selectedKey.name })}>
                            Use this key
                        </Button>
                    </>
                }
            >
                <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
                    <div className="p-3">
                        <ExistingList entries={keys} value={selected} onValueChange={setSelected} label="Keys in the Vault" />
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
            note={`Should the backups be encrypted? · ${position}`}
            onSubmit={create}
            start={<BackButton onClick={onBack} />}
            end={
                <>
                    {keys.length > 0 && (
                        <Button type="button" variant="outline" onClick={() => setView("existing")}>
                            Use existing
                        </Button>
                    )}
                    {skip}
                    <Button type="submit" disabled={creating || !name.trim()}>
                        {creating && <Loader2 className="animate-spin" />}
                        Create key
                    </Button>
                </>
            }
        >
            <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
                <div className="space-y-6 p-5">
                    <div className="grid gap-2">
                        <Label htmlFor={nameId}>Name</Label>
                        <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
                        <p className="text-xs text-muted-foreground">Shown in the Vault and on the job.</p>
                    </div>
                    <ul className="grid gap-4">
                        <Fact icon={ShieldCheck}>
                            DBackup encrypts every backup with this key before uploading it, so the destination only ever holds encrypted files.
                        </Fact>
                        <Fact icon={KeyRound}>
                            The key stays in the Vault. Download its recovery kit there and keep it somewhere safe, without it the backups cannot be opened.
                        </Fact>
                    </ul>
                </div>
            </ScrollArea>
        </StepFrame>
    );
}
