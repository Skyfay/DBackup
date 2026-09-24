"use client";

import { useId, useState } from "react";
import { Loader2, Pencil, Timer } from "lucide-react";
import type { RetentionPolicy } from "@prisma/client";
import { toast } from "sonner";
import { createRetentionPolicy, updateRetentionPolicy } from "@/app/actions/templates";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RetentionConfiguration } from "@/lib/core/retention";
import { cn } from "@/lib/utils";
import { RetentionPolicyForm } from "./retention-policy-form";

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)] [&>[data-slot=scroll-area-viewport]>div]:block!";

function configOf(policy?: RetentionPolicy): RetentionConfiguration {
    if (!policy) return { mode: "NONE" };
    try {
        return JSON.parse(policy.config) as RetentionConfiguration;
    } catch {
        return { mode: "NONE" };
    }
}

interface PolicyFormProps {
    policy?: RetentionPolicy;
    onSuccess: (policy: RetentionPolicy) => void;
}

/** The content of the dialog, mounted on every open, so it always starts from the saved policy. */
function PolicyForm({ policy, onSuccess }: PolicyFormProps) {
    const [name, setName] = useState(policy?.name ?? "");
    const [description, setDescription] = useState(policy?.description ?? "");
    const [config, setConfig] = useState<RetentionConfiguration>(() => configOf(policy));
    const [nameMissing, setNameMissing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const nameId = useId();
    const descriptionId = useId();
    const tone = policy ? "edit" : "create";

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) {
            setNameMissing(true);
            return;
        }
        setIsSaving(true);
        const input = { name: name.trim(), description, config };
        const res = policy ? await updateRetentionPolicy(policy.id, input) : await createRetentionPolicy(input);
        setIsSaving(false);
        if (res.success && res.data) {
            toast.success(policy ? "Retention policy updated" : "Retention policy created");
            onSuccess(res.data);
        } else {
            toast.error(res.error || "Failed to save retention policy");
        }
    };

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead tone={tone} icon={policy ? Pencil : Timer} className="px-5 py-4">
                <DialogTitle className="text-base">{policy ? "Edit retention policy" : "New retention policy"}</DialogTitle>
                <DialogDescription className={cn(dialogNoteClass(tone), "truncate")}>
                    {policy ? `${policy.name} · A change applies to every destination that follows it` : "Which backups a destination keeps"}
                </DialogDescription>
            </DialogHead>

            <ScrollArea className={BODY_SCROLL}>
                <div className="space-y-5 p-5">
                    <div className="space-y-2">
                        <Label htmlFor={nameId}>Name</Label>
                        <Input
                            id={nameId}
                            value={name}
                            onChange={(event) => {
                                setName(event.target.value);
                                setNameMissing(false);
                            }}
                            placeholder="e.g. Smart GFS Production"
                            autoComplete="off"
                            aria-invalid={nameMissing || undefined}
                            aria-describedby={nameMissing ? `${nameId}-message` : undefined}
                        />
                        {nameMissing && (
                            <p id={`${nameId}-message`} className="text-sm text-destructive">
                                Give the policy a name.
                            </p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor={descriptionId}>Description</Label>
                        <Input
                            id={descriptionId}
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            placeholder="Optional, like which destinations it is meant for"
                            autoComplete="off"
                        />
                    </div>
                    <RetentionPolicyForm value={config} onChange={setConfig} />
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                <DialogClose asChild>
                    <Button type="button" variant="ghost">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="animate-spin" />}
                    {policy ? "Save changes" : "Create policy"}
                </Button>
            </div>
        </form>
    );
}

interface RetentionPolicyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    policy?: RetentionPolicy;
    onSuccess: (policy: RetentionPolicy) => void;
}

/**
 * Adds a retention policy or changes one. A destination that follows a policy keeps its backups by
 * it, so a change reaches every one of them.
 */
export function RetentionPolicyDialog({ open, onOpenChange, policy, onSuccess }: RetentionPolicyDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone={policy ? "edit" : "create"} showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                <PolicyForm policy={policy} onSuccess={onSuccess} />
            </DialogContent>
        </Dialog>
    );
}
