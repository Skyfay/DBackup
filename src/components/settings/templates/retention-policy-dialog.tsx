"use client";

import { useId, useState } from "react";
import { Loader2, Pencil, Timer } from "lucide-react";
import type { RetentionPolicy } from "@prisma/client";
import { toast } from "sonner";
import { createRetentionPolicy, updateRetentionPolicy } from "@/app/actions/templates";
import { RetentionConsequences } from "@/components/templates/retention-consequences";
import { useRetentionTargets } from "@/components/templates/use-retention-targets";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RetentionConfiguration } from "@/lib/core/retention";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import { RetentionPolicyForm } from "./retention-policy-form";

const log = logger.child({ component: "RetentionPolicyDialog" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)] [&>[data-slot=scroll-area-viewport]>div]:block!";

/** A policy as the dialog edits it, from the Templates page or from a picker of the job form. */
export type EditablePolicy = Pick<RetentionPolicy, "id" | "name" | "description"> & { config: string | RetentionConfiguration };

function configOf(policy?: EditablePolicy): RetentionConfiguration {
    if (!policy) return { mode: "NONE" };
    if (typeof policy.config !== "string") return policy.config;
    try {
        return JSON.parse(policy.config) as RetentionConfiguration;
    } catch {
        return { mode: "NONE" };
    }
}

interface PolicyFormProps {
    policy?: EditablePolicy;
    onSuccess: (policy: RetentionPolicy) => void;
}

/** The content of the dialog, mounted on every open, so it always starts from the saved policy. */
function PolicyForm({ policy, onSuccess }: PolicyFormProps) {
    const saved = configOf(policy);
    const [name, setName] = useState(policy?.name ?? "");
    const [description, setDescription] = useState(policy?.description ?? "");
    const [config, setConfig] = useState<RetentionConfiguration>(saved);
    const [nameMissing, setNameMissing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const { targets, loading } = useRetentionTargets(policy ? { policyId: policy.id } : null);
    const nameId = useId();
    const descriptionId = useId();
    const tone = policy ? "edit" : "create";
    const reach = targets ? targets.targets.length : null;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) {
            setNameMissing(true);
            return;
        }
        setIsSaving(true);
        const input = { name: name.trim(), description, config };
        try {
            const res = policy ? await updateRetentionPolicy(policy.id, input) : await createRetentionPolicy(input);
            if (res.success && res.data) {
                toast.success(policy ? "Retention policy updated" : "Retention policy created");
                onSuccess(res.data);
                return;
            }
            toast.error(res.error || "The policy could not be saved.");
        } catch (error: unknown) {
            // Without the right to write templates the action throws instead of answering.
            log.warn("Retention policy could not be saved", {}, wrapError(error));
            toast.error("The policy could not be saved.");
        }
        setIsSaving(false);
    };

    // min-w-0, since a cell of the grid in the edit dialog grows with its widest line otherwise.
    const fields = (
        <div className="min-w-0 space-y-5">
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
            <RetentionPolicyForm value={config} onChange={setConfig} saved={policy ? saved : undefined} />
        </div>
    );

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead tone={tone} icon={policy ? Pencil : Timer} className="px-5 py-4">
                <DialogTitle className="truncate text-base">{policy ? `Edit ${policy.name}` : "New retention policy"}</DialogTitle>
                <DialogDescription className={cn(dialogNoteClass(tone), "truncate")}>
                    {!policy
                        ? "Which backups a destination keeps"
                        : reach === null
                          ? "A change applies to every destination that follows it"
                          : reach === 0
                            ? "No destination follows it yet"
                            : `A change applies to its ${reach === 1 ? "destination" : `${reach} destinations`}`}
                </DialogDescription>
            </DialogHead>

            <ScrollArea className={BODY_SCROLL}>
                {policy ? (
                    <div className="grid gap-6 p-5 lg:grid-cols-2">
                        {fields}
                        <section className="min-w-0 space-y-3 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6" aria-label="What the change removes">
                            <div>
                                <p className="text-sm font-semibold">{reach ? `At its ${reach === 1 ? "destination" : `${reach} destinations`}` : "At its destinations"}</p>
                                <p className="text-xs text-muted-foreground">What the next run of each job removes with this change</p>
                            </div>
                            <RetentionConsequences targets={targets} loading={loading} config={config} />
                        </section>
                    </div>
                ) : (
                    <div className="p-5">{fields}</div>
                )}
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
    policy?: EditablePolicy;
    onSuccess: (policy: RetentionPolicy) => void;
}

/**
 * Adds a retention policy or changes one. A destination that follows a policy keeps its backups by
 * it, so a change reaches every one of them: beside the form it says what the next run of each job
 * removes with the change, worked out from the backups the destinations hold now.
 */
export function RetentionPolicyDialog({ open, onOpenChange, policy, onSuccess }: RetentionPolicyDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone={policy ? "edit" : "create"} showCloseButton={false} className={cn(DIALOG_SURFACE, policy ? "sm:max-w-xl lg:max-w-4xl" : "sm:max-w-xl")}>
                <PolicyForm policy={policy} onSuccess={onSuccess} />
            </DialogContent>
        </Dialog>
    );
}
