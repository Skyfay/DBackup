"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    ArrowLeft,
    ArrowRight,
    Lock,
    CheckCircle2,
    SkipForward,
    ShieldCheck,
} from "lucide-react";
import { createEncryptionProfile } from "@/app/actions/backup/encryption";
import { WizardData } from "../setup-wizard";

interface VaultStepProps {
    wizardData: WizardData;
    onUpdate: (data: Partial<WizardData>) => void;
    onNext: () => void;
    onPrev: () => void;
    onSkip: () => void;
}

export function VaultStep({ wizardData, onUpdate, onNext, onPrev, onSkip }: VaultStepProps) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [isSaved, setIsSaved] = useState(!!wizardData.encryptionProfileId);

    const handleCreate = async () => {
        if (!name.trim()) {
            toast.error("Name is required");
            return;
        }

        setIsCreating(true);
        try {
            const result = await createEncryptionProfile(name.trim(), description.trim() || undefined);
            if (result.success && result.data) {
                toast.success("Encryption profile created");
                onUpdate({
                    encryptionProfileId: result.data.id,
                    encryptionProfileName: name.trim(),
                });
                setIsSaved(true);
            } else {
                toast.error(result.error || "Failed to create encryption profile");
            }
        } catch {
            toast.error("An error occurred");
        } finally {
            setIsCreating(false);
        }
    };

    // Already saved
    if (isSaved) {
        return (
            <div className="space-y-6">
                <div className="text-center space-y-4 py-8">
                    <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                        <CheckCircle2 className="h-8 w-8 text-green-500" />
                    </div>
                    <h3 className="text-xl font-semibold">Encryption Profile Created</h3>
                    <p className="text-muted-foreground">
                        <strong>{wizardData.encryptionProfileName}</strong> will be used to encrypt your backups.
                    </p>
                </div>
                <div className="flex justify-between pt-4">
                    <Button variant="outline" onClick={onPrev}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back
                    </Button>
                    <Button onClick={onNext}>
                        Continue
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <Lock className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold">Backup Encryption</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                    Create an encryption key to secure your backups with AES-256-GCM encryption.
                    This step is optional but highly recommended.
                </p>
            </div>

            {/* Info card */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Why encrypt your backups?</span>
                </div>
                <ul className="text-sm text-muted-foreground space-y-1 ml-6 list-disc">
                    <li>Protects sensitive data even if storage is compromised</li>
                    <li>Industry-standard AES-256-GCM encryption</li>
                    <li>Key is generated automatically and stored securely</li>
                    <li>Required for compliance in many industries</li>
                </ul>
            </div>

            {/* Form */}
            <div className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="profile-name">Profile Name</Label>
                    <Input
                        id="profile-name"
                        placeholder="Production Backup Key"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="profile-description">Description (optional)</Label>
                    <Textarea
                        id="profile-description"
                        placeholder="Encryption key for production database backups"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={2}
                    />
                </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-4">
                <Button variant="outline" onClick={onPrev}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                </Button>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={onSkip}>
                        <SkipForward className="mr-2 h-4 w-4" />
                        Skip
                    </Button>
                    <Button tone="create" onClick={handleCreate} disabled={!name.trim() || isCreating}>
                        {isCreating ? "Creating..." : "Create & Continue"}
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
