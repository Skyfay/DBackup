"use client";

import { createContext, useContext, useState } from "react";
import { Database, FolderOpen, HardDrive, Plus, type LucideIcon } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { AddConnectionDialogs } from "@/components/adapter/add-connection-dialogs";
import { connectionAddress } from "@/components/adapter/connection-summary";
import { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { STORAGE_ROLES, type StorageRole } from "@/lib/core/storage-roles";
import { cn } from "@/lib/utils";
import type { AdapterOption } from "./job-form-schema";

export type ConnectionKind = "database" | "destination" | "directory";

const KINDS: Record<ConnectionKind, { icon: LucideIcon; note: string; noun: string; type: "database" | "storage"; role?: StorageRole }> = {
    database: { icon: Database, note: "Databases", noun: "database", type: "database" },
    destination: { icon: HardDrive, note: "Destinations", noun: "destination", type: "storage", role: STORAGE_ROLES.DESTINATION },
    directory: { icon: FolderOpen, note: "Directory sources", noun: "directory source", type: "storage", role: STORAGE_ROLES.SOURCE },
};

/** Tells the form about a connection added from one of its fields, so every field offers it. */
export const ConnectionAddedContext = createContext<((option: AdapterOption) => void) | null>(null);

const STATUS: Record<string, string> = { OFFLINE: "Offline", DEGRADED: "Degraded" };

/** A connection in the list: its type, where it points and, when it is not online, how it is. */
function entryOf(option: AdapterOption): PickEntry {
    const type = getAdapterDefinition(option.adapterId)?.name ?? option.adapterId;
    const address = option.config ? connectionAddress(option.adapterId, option.config) : null;
    const status = option.lastStatus ? STATUS[option.lastStatus] : undefined;
    return {
        id: option.id,
        name: option.name,
        meta: [type, address, status].filter(Boolean).join(" · "),
        keywords: [type, ...(address ? [address] : [])],
        icon: <AdapterIcon adapterId={option.adapterId} className="size-4" />,
    };
}

interface ConnectionPickerProps extends Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> {
    options: AdapterOption[];
    value: string;
    onChange: (id: string) => void;
    placeholder: string;
    kind: ConnectionKind;
    /** Connections other rows use already, left out of the list. */
    taken?: string[];
    /** New beside the field too, where the row has room for it. */
    newBeside?: boolean;
}

/**
 * Picks one connection, like the login field of a connection form: the connections in a list that
 * says what each one is and where it points, and New at its foot, which adds one with the forms of
 * the Connections page and picks it. The props of a form field land on the button, so its label
 * names it.
 */
export function ConnectionPicker({ options, value, onChange, placeholder, kind, taken = [], newBeside = false, className, ...props }: ConnectionPickerProps) {
    const [open, setOpen] = useState(false);
    const [adding, setAdding] = useState(false);
    const [added, setAdded] = useState<AdapterOption[]>([]);
    const report = useContext(ConnectionAddedContext);
    const setup = KINDS[kind];
    const all = [...options, ...added.filter((option) => !options.some((known) => known.id === option.id))];
    const current = all.find((option) => option.id === value);
    const available = all.filter((option) => option.id === value || !taken.includes(option.id));

    const startAdding = () => {
        setOpen(false);
        setAdding(true);
    };

    return (
        <div className={cn("flex min-w-0 gap-2", className)}>
            <Popover open={open} onOpenChange={setOpen} modal>
                <PopoverTrigger asChild>
                    <PickTrigger
                        icon={setup.icon}
                        leading={current ? <AdapterIcon adapterId={current.adapterId} className="size-4 shrink-0" /> : undefined}
                        aria-expanded={open}
                        {...props}
                    >
                        <span className={cn("truncate", !current && "text-muted-foreground")}>{current ? current.name : placeholder}</span>
                    </PickTrigger>
                </PopoverTrigger>
                {/* On the raised surface, so it stands out from the dialog it opens over. */}
                <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                    <PickList
                        icon={setup.icon}
                        title="Pick from Connections"
                        note={setup.note}
                        groups={[{ entries: available.map(entryOf) }]}
                        value={value}
                        emptyText={available.length === 0 ? `There is no ${setup.noun} yet.` : "Nothing matches."}
                        onPick={(id) => {
                            onChange(id);
                            setOpen(false);
                        }}
                        createLabel={`New ${setup.noun}`}
                        onCreate={startAdding}
                        searchPlaceholder="Search by name, type or address"
                    />
                </PopoverContent>
            </Popover>
            {newBeside && (
                <Button type="button" variant="outline" onClick={startAdding}>
                    <Plus />
                    New
                </Button>
            )}
            <AddConnectionDialogs
                open={adding}
                onOpenChange={setAdding}
                type={setup.type}
                role={setup.role}
                title={`Add ${setup.noun}`}
                onSaved={(saved) => {
                    const option: AdapterOption = { ...saved, storageRole: setup.role };
                    setAdded((list) => [...list, option]);
                    report?.(option);
                    onChange(saved.id);
                }}
            />
        </div>
    );
}
