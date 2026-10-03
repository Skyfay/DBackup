"use client";

import { useId, useState } from "react";
import { KeyRound, Loader2, ShieldCheck, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { createEncryptionProfile } from "@/app/actions/backup/encryption";
import { freeKeyName } from "@/components/settings/encryption-key-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExistingList, type ExistingEntry } from "./existing-list";
import type { SetupEntry, SetupStep } from "./setup-model";
import { OpenSection } from "./setup-sections";

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
    number: number;
    step: SetupStep;
    /** The keys in the Vault, the ones made during the setup included. */
    keys: ExistingEntry[];
    picked: SetupEntry | null;
    onSkip: () => void;
    onDone: (entry: SetupEntry) => void;
}

/** A key for the backups, picked from the Vault or made here. The part can be skipped. */
export function EncryptionStep({ number, step, keys, picked, onSkip, onDone }: EncryptionStepProps) {
    const nameId = useId();
    const [name, setName] = useState(() => freeKeyName(keys.map((key) => key.name)));
    const [creating, setCreating] = useState(false);
    const [selected, setSelected] = useState<string | null>(picked?.id ?? null);
    const selectedKey = keys.find((key) => key.id === selected);

    const create = async () => {
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

    return (
        <OpenSection
            number={number}
            step={step}
            actions={
                <>
                    <Button type="button" variant="ghost" onClick={onSkip}>
                        Skip
                    </Button>
                    {keys.length > 0 && (
                        <Button type="button" variant="outline" disabled={!selectedKey} onClick={() => selectedKey && onDone({ id: selectedKey.id, name: selectedKey.name })}>
                            Use this key
                        </Button>
                    )}
                </>
            }
        >
            {keys.length > 0 && (
                <div className="mb-5">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Use a key you have</p>
                    <ExistingList entries={keys} value={selected} onValueChange={setSelected} label="Keys in the Vault" />
                </div>
            )}
            {keys.length > 0 && <p className="mb-2 text-xs font-medium text-muted-foreground">Or create a new one</p>}
            <div className="grid gap-2">
                <Label htmlFor={nameId}>Name</Label>
                <div className="flex flex-wrap gap-2">
                    <Input
                        id={nameId}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        // Enter creates the key, the part is no form of its own.
                        onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            void create();
                        }}
                        autoComplete="off"
                        className="min-w-0 flex-1 sm:max-w-sm"
                    />
                    <Button type="button" tone="create" disabled={creating || !name.trim()} onClick={() => void create()}>
                        {creating && <Loader2 className="animate-spin" />}
                        Create key
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">Shown in the Vault and on the job.</p>
            </div>
            <ul className="mt-5 grid gap-4">
                <Fact icon={ShieldCheck}>DBackup encrypts every backup with this key before uploading it, so the destination only ever holds encrypted files.</Fact>
                <Fact icon={KeyRound}>
                    The key stays in the Vault. Download its recovery kit there and keep it somewhere safe, without it the backups cannot be opened.
                </Fact>
            </ul>
        </OpenSection>
    );
}
