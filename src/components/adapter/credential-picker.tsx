"use client";

import { useEffect, useId, useState, useCallback } from "react";
import { Loader2, Plus, KeyRound, ChevronsUpDown, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
    CredentialProfileDialog,
    type CredentialProfileSummary,
} from "@/components/settings/credential-profile-dialog";
import type { CredentialType } from "@/lib/core/credentials";

interface Props {
    slot: "primary" | "ssh";
    requiredType: CredentialType;
    value: string | null | undefined;
    onChange: (id: string | null) => void;
    /** Render label/help text inline. */
    label?: string;
    description?: string;
    /** Notified with the resolved profile object whenever the selection changes (incl. after load). */
    onSelectedProfile?: (profile: CredentialProfileSummary | null) => void;
    /** Increment to trigger a profiles re-fetch (e.g. after OAuth completes). */
    refreshKey?: number;
}

/** What a profile of each type holds, shown beside the label. */
const TYPE_HINT: Record<CredentialType, string> = {
    USERNAME_PASSWORD: "User and password",
    SSH_KEY: "Key or password",
    ACCESS_KEY: "Key ID and secret",
    TOKEN: "API token",
    SMTP: "SMTP user and password",
    WEBHOOK: "URL and auth header",
    OAUTH: "Client ID and secret",
};

export function CredentialPicker({
    slot,
    requiredType,
    value,
    onChange,
    label,
    description,
    onSelectedProfile,
    refreshKey,
}: Props) {
    const [profiles, setProfiles] = useState<CredentialProfileSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<CredentialProfileSummary | null>(null);
    const [editOpen, setEditOpen] = useState(false);

    const fetchProfiles = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/credentials?type=${requiredType}`);
            const result = await res.json();
            if (!res.ok || !result.success) {
                toast.error(result.error || "Failed to load credential profiles");
                setProfiles([]);
                return;
            }
            setProfiles(result.data as CredentialProfileSummary[]);
        } finally {
            setLoading(false);
        }
    }, [requiredType]);

    useEffect(() => {
        fetchProfiles();
    }, [fetchProfiles, refreshKey]);

    const onCreated = (profile: CredentialProfileSummary) => {
        setProfiles((prev) => [profile, ...prev.filter((p) => p.id !== profile.id)]);
        onChange(profile.id);
    };

    const selected = profiles.find((p) => p.id === value);

    // Surface the resolved profile to the parent (e.g. so an OAuth form can read
    // its `secretStatus` to know whether it's authorized). Keyed on the resolved
    // id so it also fires once the profile list finishes loading.
    useEffect(() => {
        onSelectedProfile?.(selected ?? null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected?.id, selected?.updatedAt]);

    const defaultLabel = slot === "ssh" ? "SSH login" : "Login";
    const finalLabel = label ?? defaultLabel;
    const triggerId = useId();

    // A saved profile is picked from the list, a new one is one click away beside it. The
    // profile's secrets never show here, only its name.
    return (
        <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={triggerId}>{finalLabel}</Label>
                <span className="text-xs text-muted-foreground">{TYPE_HINT[requiredType]}</span>
            </div>

            <div className="flex min-w-0 gap-2">
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            id={triggerId}
                            variant="outline"
                            role="combobox"
                            aria-expanded={open}
                            disabled={loading}
                            className="min-w-0 flex-1 justify-between font-normal"
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                {loading ? (
                                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                                ) : (
                                    <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                                )}
                                {loading ? (
                                    <span className="text-muted-foreground">Loading...</span>
                                ) : selected ? (
                                    <span className="truncate">{selected.name}</span>
                                ) : (
                                    <span className="truncate text-muted-foreground">{profiles.length > 0 ? "None" : "No saved login yet"}</span>
                                )}
                            </span>
                            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                        <Command>
                            <CommandInput placeholder="Search profile..." />
                            <CommandList>
                                <CommandEmpty>No profiles found.</CommandEmpty>
                                <CommandGroup>
                                    <CommandItem
                                        value="__none__"
                                        onSelect={() => {
                                            onChange(null);
                                            setOpen(false);
                                        }}
                                    >
                                        <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                                        <span className="text-muted-foreground">None</span>
                                    </CommandItem>
                                    {profiles.map((p) => (
                                        <CommandItem
                                            key={p.id}
                                            value={p.name}
                                            className="group pr-1"
                                            onSelect={() => {
                                                onChange(p.id);
                                                setOpen(false);
                                            }}
                                        >
                                            <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                                            <span className="flex-1">{p.name}</span>
                                            <button
                                                type="button"
                                                className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 rounded p-0.5 hover:bg-accent"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setOpen(false);
                                                    setEditTarget(p);
                                                    setEditOpen(true);
                                                }}
                                            >
                                                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                            </button>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                                <CommandSeparator />
                                <CommandGroup>
                                    <CommandItem
                                        value="__create__"
                                        onSelect={() => {
                                            setOpen(false);
                                            setCreateOpen(true);
                                        }}
                                        className="font-medium"
                                    >
                                        <Plus className="mr-2 h-3.5 w-3.5" />
                                        Create new profile...
                                    </CommandItem>
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>
                    <Plus />
                    New
                </Button>
            </div>

            {description && <p className="text-xs text-muted-foreground">{description}</p>}

            <CredentialProfileDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                forcedType={requiredType}
                onSaved={onCreated}
            />
            <CredentialProfileDialog
                open={editOpen}
                onOpenChange={(v) => { setEditOpen(v); if (!v) setEditTarget(null); }}
                editProfile={editTarget}
                forcedType={requiredType}
                onSaved={(profile) => {
                    setProfiles((prev) => prev.map((x) => x.id === profile.id ? profile : x));
                    setEditTarget(null);
                    setEditOpen(false);
                }}
            />
        </div>
    );
}


