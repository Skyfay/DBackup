"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Plus, KeyRound, ChevronsUpDown, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const TYPE_BADGE: Record<CredentialType, string> = {
    USERNAME_PASSWORD: "User/Pass",
    SSH_KEY: "SSH Key",
    ACCESS_KEY: "Access Key",
    TOKEN: "Token",
    SMTP: "SMTP",
    WEBHOOK: "Webhook",
    OAUTH: "OAuth",
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

    const defaultLabel = slot === "ssh" ? "SSH Credential Profile" : "Credential Profile";
    const finalLabel = label ?? defaultLabel;

    return (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-2 text-sm font-medium">
                    <KeyRound className="h-4 w-4" />
                    {finalLabel}
                    <Badge variant="outline" className="font-normal">
                        {TYPE_BADGE[requiredType]}
                    </Badge>
                </Label>
            </div>
            {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
            )}

            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        disabled={loading}
                        className="w-full justify-between font-normal"
                    >
                        {loading ? (
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Loading...
                            </span>
                        ) : selected ? (
                            selected.name
                        ) : (
                            <span className="text-muted-foreground">None</span>
                        )}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
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

            {!loading && profiles.length === 0 && (
                <p className="text-xs text-muted-foreground">
                    No matching profiles yet. Use{" "}
                    <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0 text-xs"
                        onClick={() => setCreateOpen(true)}
                    >
                        Create new profile
                    </Button>{" "}
                    to add one.
                </p>
            )}

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


