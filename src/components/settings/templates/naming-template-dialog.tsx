"use client";

import { useId, useRef, useState } from "react";
import { FileText, Loader2, Pencil, TriangleAlert } from "lucide-react";
import type { NamingTemplate } from "@prisma/client";
import { toast } from "sonner";
import { createNamingTemplate, updateNamingTemplate } from "@/app/actions/templates";
import { useSchedulerTimezone } from "@/components/dashboard/jobs/use-scheduler-timezone";
import { hasDateOrTime, hasTimeOfDay } from "@/components/templates/naming-collisions";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { applyNamingPattern, NAMING_TOKEN_GROUPS, patternUsesChain } from "@/lib/templates/naming-template-engine";
import { cn } from "@/lib/utils";

const log = logger.child({ component: "NamingTemplateDialog" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)] [&>[data-slot=scroll-area-viewport]>div]:block!";
const STARTING_PATTERN = "{job_name}_yyyy-MM-dd_HH-mm-ss";

/** A file name the way the runner writes it, for a job called Shop nightly with the database shop. */
function exampleOf(pattern: string, timezone: string, chain = ""): string {
    return `${applyNamingPattern(pattern, "Shop_nightly", "shop", new Date(), timezone, chain)}.tar`;
}

function Example({ name }: { name: string }) {
    return (
        <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm text-muted-foreground">
            <span className="truncate">{name}</span>
        </div>
    );
}

interface TemplateFormProps {
    template?: NamingTemplate;
    onSuccess: (template: NamingTemplate) => void;
}

/** The content of the dialog, mounted on every open, so it always starts from the saved template. */
function TemplateForm({ template, onSuccess }: TemplateFormProps) {
    const [name, setName] = useState(template?.name ?? "");
    const [description, setDescription] = useState(template?.description ?? "");
    const [pattern, setPattern] = useState(template?.pattern ?? STARTING_PATTERN);
    const [problem, setProblem] = useState<{ field: "name" | "pattern"; text: string } | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const patternRef = useRef<HTMLInputElement>(null);
    const timezone = useSchedulerTimezone() ?? "UTC";
    const nameId = useId();
    const tone = template ? "edit" : "create";
    const usesChain = patternUsesChain(pattern);

    const insertToken = (token: string) => {
        const input = patternRef.current;
        const start = input?.selectionStart ?? pattern.length;
        const end = input?.selectionEnd ?? pattern.length;
        setPattern(pattern.slice(0, start) + token + pattern.slice(end));
        setProblem(null);
        requestAnimationFrame(() => {
            input?.focus();
            input?.setSelectionRange(start + token.length, start + token.length);
        });
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) return setProblem({ field: "name", text: "Give the template a name." });
        if (!pattern.trim()) return setProblem({ field: "pattern", text: "Give the template a pattern." });
        setIsSaving(true);
        const input = { name: name.trim(), description: description.trim(), pattern: pattern.trim() };
        try {
            const res = template ? await updateNamingTemplate(template.id, input) : await createNamingTemplate(input);
            if (res.success && res.data) {
                toast.success(template ? "Naming template updated" : "Naming template created");
                onSuccess(res.data);
                return;
            }
            toast.error(res.error || "The template could not be saved.");
        } catch (error: unknown) {
            // Without the right to write templates the action throws instead of answering.
            log.warn("Naming template could not be saved", {}, wrapError(error));
            toast.error("The template could not be saved.");
        }
        setIsSaving(false);
    };

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead tone={tone} icon={template ? Pencil : FileText} className="px-5 py-4">
                <DialogTitle className="text-base">{template ? "Edit naming template" : "New naming template"}</DialogTitle>
                <DialogDescription className={cn(dialogNoteClass(tone), "truncate")}>
                    {template ? `${template.name} · A change applies to every job that uses it` : "How the backup files of a job are named"}
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
                                setProblem(null);
                            }}
                            placeholder="e.g. Date and time"
                            autoComplete="off"
                            aria-invalid={problem?.field === "name" || undefined}
                        />
                        {problem?.field === "name" && <p className="text-sm text-destructive">{problem.text}</p>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor={`${nameId}-description`}>Description</Label>
                        <Input
                            id={`${nameId}-description`}
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            placeholder="Optional, like which jobs it is meant for"
                            autoComplete="off"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor={`${nameId}-pattern`}>Pattern</Label>
                        <Input
                            ref={patternRef}
                            id={`${nameId}-pattern`}
                            value={pattern}
                            onChange={(event) => {
                                setPattern(event.target.value);
                                setProblem(null);
                            }}
                            placeholder={STARTING_PATTERN}
                            autoComplete="off"
                            spellCheck={false}
                            className="font-mono"
                            aria-invalid={problem?.field === "pattern" || undefined}
                        />
                        {problem?.field === "pattern" && <p className="text-sm text-destructive">{problem.text}</p>}
                        <div className="grid gap-1.5 pt-1">
                            {NAMING_TOKEN_GROUPS.map((group) => (
                                <div key={group.group} className="flex flex-wrap items-center gap-1.5">
                                    <span className="w-16 shrink-0 text-xs text-muted-foreground">{group.group}</span>
                                    {group.tokens.map((info) => (
                                        <Tooltip key={info.token}>
                                            <TooltipTrigger asChild>
                                                <Button type="button" variant="outline" size="sm" className="h-6 px-2 font-mono text-xs" onClick={() => insertToken(info.token)}>
                                                    {info.token}
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="top">{info.description}</TooltipContent>
                                        </Tooltip>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between gap-3">
                            <p className="text-sm font-medium">Preview</p>
                            <span className="text-xs text-muted-foreground">A job called Shop nightly, times in {timezone}</span>
                        </div>
                        <Example name={exampleOf(pattern, timezone, usesChain ? "inc-001" : "")} />
                        {usesChain && (
                            <>
                                <p className="text-xs text-muted-foreground">Above an incremental run. Every other job leaves out the token and the separator beside it:</p>
                                <Example name={exampleOf(pattern, timezone)} />
                            </>
                        )}
                    </div>

                    {pattern.trim() && !hasTimeOfDay(pattern) && (
                        <div role="status" className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                            <TriangleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
                            <span>
                                {hasDateOrTime(pattern)
                                    ? "Without the time of day, the backups of a job on one day get the same name. A second run that day replaces the first at every destination, unless the job is incremental."
                                    : "Without a date, every backup of a job gets the same name and replaces the one before at every destination, unless the job is incremental."}
                            </span>
                        </div>
                    )}
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                <DialogClose asChild>
                    <Button type="button" variant="ghost">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="animate-spin" />}
                    {template ? "Save changes" : "Create template"}
                </Button>
            </div>
        </form>
    );
}

interface NamingTemplateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    template?: NamingTemplate;
    onSuccess: (template: NamingTemplate) => void;
}

/**
 * Adds a naming template or changes one: the pattern the backup files of a job are named by, with
 * a preview of a real name and a warning when the pattern lets two backups get the same one.
 */
export function NamingTemplateDialog({ open, onOpenChange, template, onSuccess }: NamingTemplateDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone={template ? "edit" : "create"} showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                <TemplateForm template={template} onSuccess={onSuccess} />
            </DialogContent>
        </Dialog>
    );
}
