"use client";

import { createContext, useContext, useState } from "react";
import { Bell, Database, FolderOpen, HardDrive, Plus, type LucideIcon } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { AddConnectionDialogs } from "@/components/adapter/add-connection-dialogs";
import { connectionAddress } from "@/lib/adapters/connection-summary";
import { useCan } from "@/components/permissions/permissions-context";
import { useMayAdd } from "@/components/tenant/tenant-view";
import type { AllowanceKind } from "@/lib/tenant/allowances";
import { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { STORAGE_ROLES, type StorageRole } from "@/lib/core/storage-roles";
import { cn } from "@/lib/utils";
import type { AdapterOption } from "./job-form-schema";
import { isAirGapped } from "@/lib/core/air-gap";

export type ConnectionKind = "database" | "destination" | "directory" | "notification";

/** What each kind is called, where it comes from, who may add one and which limit of the platform holds it. */
const KINDS: Record<ConnectionKind, { icon: LucideIcon; note: string; noun: string; type: "database" | "storage" | "notification"; role?: StorageRole; write: Permission; allowance: AllowanceKind }> = {
    database: { icon: Database, note: "Databases", noun: "database", type: "database", write: PERMISSIONS.SOURCES.WRITE, allowance: "databases" },
    destination: { icon: HardDrive, note: "Destinations", noun: "destination", type: "storage", role: STORAGE_ROLES.DESTINATION, write: PERMISSIONS.DESTINATIONS.WRITE, allowance: "destinations" },
    directory: { icon: FolderOpen, note: "Directory sources", noun: "directory source", type: "storage", role: STORAGE_ROLES.SOURCE, write: PERMISSIONS.DESTINATIONS.WRITE, allowance: "directorySources" },
    notification: { icon: Bell, note: "Notification channels", noun: "notification channel", type: "notification", write: PERMISSIONS.NOTIFICATIONS.WRITE, allowance: "channels" },
};

/** The tenant that shares a connection with this one, null for an own connection. */
const providerOf = (option: AdapterOption) => option.provided?.providerName ?? option.provider ?? null;

/**
 * The connections of the list, in groups once another tenant shares some with this one: the own
 * ones first under Yours, then those of each tenant that shares them.
 */
function groupsOf(options: AdapterOption[]) {
    const shared = options.filter((option) => providerOf(option));
    if (shared.length === 0) return [{ entries: options.map(entryOf) }];
    const own = options.filter((option) => !providerOf(option));
    const providers = [...new Set(shared.map((option) => providerOf(option)!))];
    return [
        ...(own.length > 0 ? [{ heading: "Yours", entries: own.map(entryOf) }] : []),
        ...providers.map((name) => ({ heading: `Provided by ${name}`, entries: shared.filter((option) => providerOf(option) === name).map(entryOf) })),
    ];
}

/** Tells the form about a connection added from one of its fields, so every field offers it. */
export const ConnectionAddedContext = createContext<((option: AdapterOption) => void) | null>(null);

/** How the last health check found a connection that is not online, in the color of its state. */
const STATUS: Record<string, PickEntry["alert"]> = { OFFLINE: { text: "Offline", tone: "destructive" }, DEGRADED: { text: "Degraded", tone: "warning" } };

/**
 * A connection in the list: its type, where it points and, first in its color, how it is when it
 * is not online. An air-gapped destination that is not connected says so without a warning.
 */
function entryOf(option: AdapterOption): PickEntry {
    const type = getAdapterDefinition(option.adapterId)?.name ?? option.adapterId;
    // Where a connection another tenant shares points stays with that tenant.
    const shared = Boolean(providerOf(option));
    const address = option.config && !shared ? connectionAddress(option.adapterId, option.config) : null;
    const away = Boolean(option.lastStatus && option.lastStatus !== "ONLINE") && isAirGapped(option);
    return {
        id: option.id,
        name: option.name,
        meta: [type, address, shared ? "address hidden" : null, option.provided?.encryptedOnly ? "only encrypted backups" : null, away ? "air-gapped, not connected" : null]
            .filter(Boolean)
            .join(" · "),
        keywords: [type, ...(address ? [address] : [])],
        icon: <AdapterIcon adapterId={option.adapterId} className="size-4" />,
        alert: !away && option.lastStatus ? STATUS[option.lastStatus] : undefined,
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
 * the Connections page and picks it, for a viewer who may add the kind. The props of a form field
 * land on the button, so its label names it.
 */
export function ConnectionPicker({ options, value, onChange, placeholder, kind, taken = [], newBeside = false, className, ...props }: ConnectionPickerProps) {
    const [open, setOpen] = useState(false);
    const [adding, setAdding] = useState(false);
    const [added, setAdded] = useState<AdapterOption[]>([]);
    const report = useContext(ConnectionAddedContext);
    const setup = KINDS[kind];
    // New only where the viewer may add the kind, and the platform lets the tenant add it itself.
    const mayWrite = useCan(setup.write);
    const mayAdd = useMayAdd(setup.allowance);
    const canCreate = mayWrite && mayAdd;
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
                <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden p-0">
                    <PickList
                        icon={setup.icon}
                        title="Pick from Connections"
                        note={setup.note}
                        groups={groupsOf(available)}
                        value={value}
                        emptyText={available.length === 0 ? `There is no ${setup.noun} yet.` : "Nothing matches."}
                        onPick={(id) => {
                            onChange(id);
                            setOpen(false);
                        }}
                        createLabel={`New ${setup.noun}`}
                        onCreate={canCreate ? startAdding : undefined}
                        searchPlaceholder="Search by name, type or address"
                    />
                </PopoverContent>
            </Popover>
            {newBeside && canCreate && (
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
                title={`New ${setup.noun}`}
                onSaved={(saved) => {
                    const option: AdapterOption = { ...saved, type: setup.type, storageRole: setup.role };
                    setAdded((list) => [...list, option]);
                    report?.(option);
                    onChange(saved.id);
                }}
            />
        </div>
    );
}
