"use client";

import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { KeyRound, ShieldAlert } from "lucide-react";
import { getEncryptionProfiles } from "@/app/actions/backup/encryption";

export type KeyResolutionResult =
    | { type: "profile"; profileId: string }
    | { type: "rawKey"; keyHex: string };

interface EncryptionKeyResolutionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The profile ID from the backup metadata (shown as hint). */
    profileIdHint?: string;
    /** Called when the user confirms a key selection. */
    onConfirm: (result: KeyResolutionResult) => void;
    /** Shows a spinner on the confirm button while the parent is processing. */
    loading?: boolean;
}

export function EncryptionKeyResolutionDialog({
    open,
    onOpenChange,
    profileIdHint,
    onConfirm,
    loading = false,
}: EncryptionKeyResolutionDialogProps) {
    const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
    const [selectedProfileId, setSelectedProfileId] = useState<string>("");
    const [rawKeyHex, setRawKeyHex] = useState("");
    const [rawKeyError, setRawKeyError] = useState("");
    const [activeTab, setActiveTab] = useState<"profile" | "rawKey">("profile");

    // Fetch profiles when dialog opens
    useEffect(() => {
        if (!open) return;
        getEncryptionProfiles().then((res) => {
            if (res.success && res.data) {
                setProfiles(res.data.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
            }
        }).catch(() => {});
    }, [open]);

    const handleConfirm = () => {
        if (activeTab === "profile") {
            if (!selectedProfileId) return;
            onConfirm({ type: "profile", profileId: selectedProfileId });
        } else {
            const clean = rawKeyHex.trim();
            if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
                setRawKeyError("Must be a 64-character hex string (32 bytes).");
                return;
            }
            setRawKeyError("");
            onConfirm({ type: "rawKey", keyHex: clean });
        }
    };

    const isConfirmDisabled =
        loading ||
        (activeTab === "profile" && !selectedProfileId) ||
        (activeTab === "rawKey" && rawKeyHex.trim().length === 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <KeyRound className="h-5 w-5 text-amber-500" />
                        <DialogTitle>Encryption Key Required</DialogTitle>
                    </div>
                    <DialogDescription>
                        The encryption key for this backup could not be resolved automatically.
                        Please specify the key to use for decryption.
                    </DialogDescription>
                </DialogHeader>

                {profileIdHint && (
                    <Alert variant="default" className="bg-muted">
                        <ShieldAlert className="h-4 w-4" />
                        <AlertDescription className="text-xs font-mono break-all">
                            Expected profile ID: {profileIdHint}
                        </AlertDescription>
                    </Alert>
                )}

                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "profile" | "rawKey")}>
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="profile">Select Profile</TabsTrigger>
                        <TabsTrigger value="rawKey">Enter Raw Key</TabsTrigger>
                    </TabsList>

                    <TabsContent value="profile" className="space-y-3 pt-2">
                        <div className="space-y-2">
                            <Label>Encryption Profile (Vault)</Label>
                            {profiles.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No encryption profiles found in this vault. Import the original key first, or use the raw key tab.
                                </p>
                            ) : (
                                <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a vault profile..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {profiles.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>
                                                {p.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </TabsContent>

                    <TabsContent value="rawKey" className="space-y-3 pt-2">
                        <div className="space-y-2">
                            <Label htmlFor="rawKeyHex">Master Key (64-char hex)</Label>
                            <Input
                                id="rawKeyHex"
                                value={rawKeyHex}
                                onChange={(e) => {
                                    setRawKeyHex(e.target.value);
                                    setRawKeyError("");
                                }}
                                placeholder="e.g. a3f9c1..."
                                className="font-mono text-sm"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            {rawKeyError && (
                                <p className="text-xs text-destructive">{rawKeyError}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                The raw 32-byte AES-256-GCM key exported from Security Vault. This key is used once for decryption and is not stored.
                            </p>
                        </div>
                    </TabsContent>
                </Tabs>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={isConfirmDisabled}>
                        {loading ? "Decrypting..." : "Decrypt"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
