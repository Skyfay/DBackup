"use client";

import { useState } from "react";
import { DIALOG_SURFACE } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ADAPTER_DEFINITIONS, type AdapterDefinition } from "@/lib/adapters/definitions";
import { supportsStorageRole, type StorageRole } from "@/lib/core/storage-roles";
import { cn } from "@/lib/utils";
import { AdapterPickerDialog } from "./adapter-picker";
import { ConnectionForm } from "./connection-form";
import type { SavedConnection } from "./use-connection-form";

interface AddConnectionDialogsProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    type: "database" | "storage" | "notification";
    /** The role a new storage connection gets, kept as it is. */
    role?: StorageRole;
    /** Names what is added, like "Add destination". */
    title: string;
    onSaved: (saved: SavedConnection) => void;
}

/**
 * Adding a connection from somewhere else than the Connections page, like a field of the job
 * form: the list of types first, then the connection form, the same two dialogs as on that page.
 */
export function AddConnectionDialogs({ open, onOpenChange, type, role, title, onSaved }: AddConnectionDialogsProps) {
    const [adapter, setAdapter] = useState<AdapterDefinition | null>(null);
    // A type that cannot serve the role is left out, the server would refuse it anyway.
    const adapters = ADAPTER_DEFINITIONS.filter((definition) => definition.type === type && (!role || supportsStorageRole(definition.supportedRoles, role)));

    const close = () => {
        setAdapter(null);
        onOpenChange(false);
    };

    return (
        <>
            <Dialog open={open && !adapter} onOpenChange={(next) => !next && close()}>
                <DialogContent tone="create" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                    <AdapterPickerDialog adapters={adapters} title={title} onSelect={setAdapter} />
                </DialogContent>
            </Dialog>
            <Dialog open={open && !!adapter} onOpenChange={(next) => !next && close()}>
                <DialogContent showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-3xl sm:has-data-[single-part]:max-w-xl")}>
                    {adapter && (
                        <ConnectionForm
                            adapter={adapter}
                            defaultRole={role}
                            lockRole={!!role}
                            onBack={() => setAdapter(null)}
                            onSaved={(saved) => {
                                close();
                                if (saved) onSaved(saved);
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
