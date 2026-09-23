"use client";

import { useEffect, useId, useState, useCallback } from "react";
import { Loader2, Plus, KeyRound, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import {
    CredentialProfileDialog,
    type CredentialProfileSummary,
} from "@/components/settings/credential-profile-dialog";
import type { CredentialType } from "@/lib/core/credentials";
import { CREDENTIAL_TYPE_INFO, nounOf } from "@/components/settings/credential-types";
import { LoginList, type PickerAdapter } from "./credential-picker-list";

interface Props {
    slot: "primary" | "ssh";
    requiredType: CredentialType;
    value: string | null | undefined;
    onChange: (id: string | null) => void;
    /** Render label/help text inline. */
    label?: string;
    description?: string;
    /** The kind of connection the login is for, so the list can suggest what its other connections use. */
    adapter?: PickerAdapter;
    /** The connection cannot work without a login, so nothing offers to clear it. */
    required?: boolean;
    /** Notified with the resolved profile object whenever the selection changes (incl. after load). */
    onSelectedProfile?: (profile: CredentialProfileSummary | null) => void;
    /** Increment to trigger a profiles re-fetch (e.g. after OAuth completes). */
    refreshKey?: number;
}

export function CredentialPicker({
    slot,
    requiredType,
    value,
    onChange,
    label,
    description,
    adapter,
    required = false,
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
            // With their usage, which the list shows and groups by.
            const res = await fetch(`/api/credentials?type=${requiredType}&includeCounts=true`);
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
    // profile's secrets never show here, only its name, description and where it is used.
    return (
        <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={triggerId}>{finalLabel}</Label>
                <span className="text-xs text-muted-foreground">{CREDENTIAL_TYPE_INFO[requiredType].hint}</span>
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
                            className="min-w-0 flex-1 justify-between font-normal focus-visible:border-tone-ring focus-visible:ring-tone-ring/50"
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
                                    <span className="truncate text-muted-foreground">
                                        {profiles.length === 0 ? "No saved login yet" : required ? "Pick from the Vault" : "None"}
                                    </span>
                                )}
                            </span>
                            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                        </Button>
                    </PopoverTrigger>
                    {/* On the raised surface, so it stands out from the dialog it opens over. */}
                    <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                        <LoginList
                            profiles={profiles}
                            value={value}
                            requiredType={requiredType}
                            adapter={adapter}
                            noun={finalLabel}
                            required={required}
                            onPick={(id) => {
                                onChange(id);
                                setOpen(false);
                            }}
                            onEdit={(profile) => {
                                setOpen(false);
                                setEditTarget(profile);
                                setEditOpen(true);
                            }}
                            onCreate={() => {
                                setOpen(false);
                                setCreateOpen(true);
                            }}
                        />
                    </PopoverContent>
                </Popover>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>
                    <Plus />
                    New
                </Button>
            </div>

            {description && <p className="text-xs text-muted-foreground">{description}</p>}

            {/* The field knows the kind it needs, so the dialog opens on the form for it, named like the field. */}
            <CredentialProfileDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                forcedType={requiredType}
                noun={nounOf(finalLabel)}
                forName={adapter?.name}
                onSaved={onCreated}
            />
            <CredentialProfileDialog
                open={editOpen}
                onOpenChange={(v) => { setEditOpen(v); if (!v) setEditTarget(null); }}
                editProfile={editTarget}
                forcedType={requiredType}
                noun={nounOf(finalLabel)}
                onSaved={(profile) => {
                    // The saved profile comes without its usage, which has not changed.
                    setProfiles((prev) => prev.map((x) => x.id === profile.id ? { ...x, ...profile } : x));
                    setEditTarget(null);
                    setEditOpen(false);
                }}
            />
        </div>
    );
}


