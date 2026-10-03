"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getEncryptionProfiles, recoverEncryptionKeyAction } from "@/app/actions/backup/encryption";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/** A key of the Vault as the dialog lists it. */
interface VaultKey {
    id: string;
    name: string;
    description: string | null;
    jobs: number;
}

function entryOf(key: VaultKey): PickEntry {
    const usage = key.jobs === 0 ? "Not used by a job" : key.jobs === 1 ? "Used by 1 job" : `Used by ${key.jobs} jobs`;
    return { id: key.id, name: key.name, meta: [key.description, usage].filter(Boolean).join(" · "), keywords: key.description ? [key.description] : undefined };
}

export type KeyResolutionResult =
    | { type: "profile"; profileId: string }
    | { type: "rawKey"; keyHex: string };

/**
 * Where the backup lives, when it is one the server can reach.
 *
 * Present means a typed key can be checked against the backup itself and then kept in the
 * vault, which is what makes the next step - and anything running unattended later - work
 * without asking again. Absent (an uploaded file) leaves the key in play for this one
 * operation, because there is no stored backup left to test it against.
 */
export interface RecoverableBackup {
    storageConfigId: string;
    file: string;
}

interface EncryptionKeyResolutionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The profile ID from the backup metadata (shown as hint). */
    profileIdHint?: string;
    /** Enables checking a typed key against the backup and saving it to the vault. */
    backup?: RecoverableBackup;
    /** Whether this user may create vault profiles. Without it, only picking one is offered. */
    canManageVault?: boolean;
    /** Called when the user confirms a key selection. */
    onConfirm: (result: KeyResolutionResult) => void;
    /** Shows a spinner on the confirm button while the parent is processing. */
    loading?: boolean;
    /** Why the last attempt did not work. Keeps the dialog usable for a second try. */
    error?: string;
}

export function EncryptionKeyResolutionDialog({
    open,
    onOpenChange,
    profileIdHint,
    backup,
    canManageVault = true,
    onConfirm,
    loading = false,
    error,
}: EncryptionKeyResolutionDialogProps) {
    const [profiles, setProfiles] = useState<VaultKey[]>([]);
    const [picking, setPicking] = useState(false);
    const [selectedProfileId, setSelectedProfileId] = useState<string>("");
    const [rawKeyHex, setRawKeyHex] = useState("");
    const [profileName, setProfileName] = useState("");
    const [rawKeyError, setRawKeyError] = useState("");
    const [recovering, setRecovering] = useState(false);
    const [activeTab, setActiveTab] = useState<"profile" | "rawKey">("profile");

    // A typed key is only offered where it can lead somewhere: the server must be able to
    // reach the backup to test it, and the user must be allowed to create the profile.
    const canUseRawKey = !backup || canManageVault;
    const savesToVault = Boolean(backup) && canManageVault;

    // Fetch profiles when dialog opens; auto-switch to raw key tab if vault is empty
    useEffect(() => {
        if (!open) return;
        getEncryptionProfiles().then((res) => {
            if (res.success && res.data) {
                const mapped = res.data.map((p: { id: string; name: string; description?: string | null; _count?: { jobs: number } }) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description ?? null,
                    jobs: p._count?.jobs ?? 0,
                }));
                setProfiles(mapped);
                setActiveTab(mapped.length === 0 && canUseRawKey ? "rawKey" : "profile");
            } else if (canUseRawKey) {
                setActiveTab("rawKey");
            }
        }).catch(() => { if (canUseRawKey) setActiveTab("rawKey"); });
    }, [open, canUseRawKey]);

    const handleConfirm = async () => {
        if (activeTab === "profile") {
            if (!selectedProfileId) return;
            onConfirm({ type: "profile", profileId: selectedProfileId });
            return;
        }

        const clean = rawKeyHex.trim();
        if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
            setRawKeyError("A key is 64 characters of 0 to 9 and a to f.");
            return;
        }
        setRawKeyError("");

        if (!savesToVault) {
            // No stored backup to test against - the operation itself is the check.
            onConfirm({ type: "rawKey", keyHex: clean });
            return;
        }

        setRecovering(true);
        try {
            const res = await recoverEncryptionKeyAction(backup!.storageConfigId, backup!.file, clean, profileName.trim() || undefined);
            if (!res.success || !res.data?.profileId) {
                setRawKeyError(res.error ?? "This key does not open this backup.");
                return;
            }

            toast.success(
                res.data.status === "existing"
                    ? `That key is already in the vault as "${res.data.profileName}".`
                    : `Key saved to the vault as "${res.data.profileName}".`
            );
            // From here it is an ordinary profile, so the retry needs nothing special.
            onConfirm({ type: "profile", profileId: res.data.profileId });
        } catch (e: unknown) {
            setRawKeyError(e instanceof Error ? e.message : "The key could not be checked.");
        } finally {
            setRecovering(false);
        }
    };

    const busy = loading || recovering;
    const isConfirmDisabled =
        busy ||
        (activeTab === "profile" && !selectedProfileId) ||
        (activeTab === "rawKey" && rawKeyHex.trim().length === 0);

    const picked = profiles.find((profile) => profile.id === selectedProfileId);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone="pick" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                <DialogHead tone="pick" icon={KeyRound}>
                    <DialogTitle className="text-base">This backup needs its key</DialogTitle>
                    <DialogDescription className={dialogNoteClass("pick")}>DBackup found none that opens it</DialogDescription>
                </DialogHead>

                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]">
                    <div className="space-y-4 p-5">
                        {profileIdHint && (
                            <p className="text-sm text-muted-foreground">
                                The backup names the key <span className="font-mono text-xs break-all text-foreground">{profileIdHint}</span>, which this Vault does not hold under that name.
                            </p>
                        )}

                        {error && (
                            <p role="alert" className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
                                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                                <span className="min-w-0 break-words">{error}</span>
                            </p>
                        )}

                        <ChoiceCards
                            value={activeTab}
                            onValueChange={(next) => setActiveTab(next === "rawKey" ? "rawKey" : "profile")}
                            options={[
                                { value: "profile", title: "A key of the Vault", description: "One the Vault holds, maybe under another name." },
                                {
                                    value: "rawKey",
                                    title: "Type the key",
                                    description: "The 64 characters from its recovery kit.",
                                    disabled: !canUseRawKey,
                                    badge: canUseRawKey ? undefined : "Needs the right to write to the Vault",
                                },
                            ]}
                        />

                        {activeTab === "profile" ? (
                            <div className="space-y-2">
                                <Label>The key</Label>
                                {profiles.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        {canUseRawKey
                                            ? "The Vault holds no key yet. Type the key, or import it into the Vault first."
                                            : "The Vault holds no key yet. Ask someone who may write to the Vault to import it."}
                                    </p>
                                ) : (
                                    <Popover open={picking} onOpenChange={setPicking} modal>
                                        <PopoverTrigger asChild>
                                            <PickTrigger icon={KeyRound} aria-expanded={picking} className="w-full flex-none">
                                                <span className={cn("truncate", !picked && "text-muted-foreground")}>{picked ? picked.name : "Pick a key"}</span>
                                            </PickTrigger>
                                        </PopoverTrigger>
                                        <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden p-0">
                                            <PickList
                                                icon={KeyRound}
                                                title="Pick from the Vault"
                                                note="Encryption keys"
                                                groups={[{ entries: profiles.map(entryOf) }]}
                                                value={selectedProfileId}
                                                emptyText="Nothing matches."
                                                onPick={(id) => {
                                                    setSelectedProfileId(id);
                                                    setPicking(false);
                                                }}
                                            />
                                        </PopoverContent>
                                    </Popover>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="rawKeyHex">The key</Label>
                                    <Input
                                        id="rawKeyHex"
                                        value={rawKeyHex}
                                        onChange={(e) => {
                                            setRawKeyHex(e.target.value);
                                            setRawKeyError("");
                                        }}
                                        placeholder="64 characters from the recovery kit"
                                        className="font-mono text-sm"
                                        autoComplete="off"
                                        spellCheck={false}
                                        aria-invalid={rawKeyError ? true : undefined}
                                    />
                                    {rawKeyError && <p className="text-xs text-destructive">{rawKeyError}</p>}
                                    <p className="text-xs text-muted-foreground">
                                        {savesToVault
                                            ? "It is checked against this backup and kept in the Vault, so every later step and every run in the background can use it."
                                            : "It opens this backup once and is not kept."}
                                    </p>
                                </div>

                                {savesToVault && (
                                    <div className="space-y-2">
                                        <Label htmlFor="recoveredProfileName">Keep it as</Label>
                                        <Input
                                            id="recoveredProfileName"
                                            value={profileName}
                                            onChange={(e) => setProfileName(e.target.value)}
                                            placeholder="Named after the job of the backup"
                                            autoComplete="off"
                                        />
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </ScrollArea>

                <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={isConfirmDisabled}>
                        {busy && <Loader2 className="animate-spin" />}
                        {recovering ? "Checking the key" : loading ? "Opening the backup" : "Use this key"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
