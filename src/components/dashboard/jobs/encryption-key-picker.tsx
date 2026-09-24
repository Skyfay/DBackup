"use client";

import { useState } from "react";
import { KeyRound, LockOpen, Plus } from "lucide-react";
import { EncryptionKeyDialog } from "@/components/settings/encryption-key-dialog";
import { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { NO_ENCRYPTION, type EncryptionOption } from "./job-form-schema";

const byName = (a: EncryptionOption, b: EncryptionOption) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

const NONE: PickEntry = { id: NO_ENCRYPTION, name: "No encryption", meta: "The backups are stored as they are", glyph: LockOpen, editable: false };

function usage(key: EncryptionOption): string {
    const count = key.jobCount ?? 0;
    if (count === 0) return "Not used yet";
    return count === 1 ? "Used by 1 job" : `Used by ${count} jobs`;
}

function entryOf(key: EncryptionOption): PickEntry {
    return {
        id: key.id,
        name: key.name,
        meta: [key.description, usage(key)].filter(Boolean).join(" · "),
        keywords: key.description ? [key.description] : undefined,
    };
}

interface EncryptionKeyPickerProps extends Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> {
    keys: EncryptionOption[];
    /** The id of the key, or NO_ENCRYPTION. */
    value: string;
    onChange: (id: string) => void;
}

/**
 * Picks the key a job encrypts its backups with, like the login field of a connection: No
 * encryption and the keys of the Vault in a list that says how many jobs use each one, and New,
 * which makes a key and picks it. The props of a form field land on the button, so its label
 * names it.
 */
export function EncryptionKeyPicker({ keys, value, onChange, className, ...props }: EncryptionKeyPickerProps) {
    const [open, setOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [added, setAdded] = useState<EncryptionOption[]>([]);
    const all = [...keys, ...added.filter((key) => !keys.some((known) => known.id === key.id))].sort(byName);
    const current = all.find((key) => key.id === value);
    const encrypted = value !== NO_ENCRYPTION;

    const startCreating = () => {
        setOpen(false);
        setCreating(true);
    };

    return (
        <div className={cn("flex min-w-0 gap-2", className)}>
            <Popover open={open} onOpenChange={setOpen} modal>
                <PopoverTrigger asChild>
                    <PickTrigger icon={encrypted ? KeyRound : LockOpen} aria-expanded={open} {...props}>
                        <span className={cn("truncate", !current && "text-muted-foreground")}>
                            {current ? current.name : encrypted ? "Pick a key" : "No encryption"}
                        </span>
                    </PickTrigger>
                </PopoverTrigger>
                {/* On the raised surface, so it stands out from the dialog it opens over. */}
                <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                    <PickList
                        icon={KeyRound}
                        title="Pick from the Vault"
                        note="Encryption keys"
                        groups={[{ entries: [NONE] }, { heading: "Keys", entries: all.map(entryOf) }]}
                        value={value}
                        emptyText="Nothing matches."
                        onPick={(id) => {
                            onChange(id);
                            setOpen(false);
                        }}
                        createLabel="New key"
                        onCreate={startCreating}
                        aside={all.length === 0 && <span className="truncate text-xs text-muted-foreground">The Vault holds no key yet</span>}
                    />
                </PopoverContent>
            </Popover>
            <Button type="button" variant="outline" onClick={startCreating}>
                <Plus />
                New
            </Button>

            <EncryptionKeyDialog
                open={creating}
                onOpenChange={setCreating}
                taken={all.map((key) => key.name)}
                onCreated={(key) => {
                    setAdded((list) => [...list, { ...key, jobCount: 0 }]);
                    onChange(key.id);
                    setCreating(false);
                }}
            />
        </div>
    );
}
