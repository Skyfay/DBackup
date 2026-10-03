"use client";

import { useId, useRef, useState } from "react";
import { Copy, Loader2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)] [&>[data-slot=scroll-area-viewport]>div]:block!";

/** Something the copy gets, or something left to do with it, in one sentence. */
export interface CloneFact {
    icon: LucideIcon;
    text: string;
}

/**
 * "Shop (Copy)", or "Shop (Copy 2)" and on while a name is taken, the way the server names a copy
 * it gets no name for. Names are compared without case.
 */
export function freeCopyName(from: string, label: string, taken: string[]): string {
    const names = new Set(taken.map((name) => name.toLowerCase()));
    let name = `${from} (${label})`;
    for (let number = 2; names.has(name.toLowerCase()); number++) name = `${from} (${label} ${number})`;
    return name;
}

interface CloneDialogProps {
    /** What the dialog makes, like "Clone job" or "Create as directory source". */
    title: string;
    /** The name of the entry the copy is made from. */
    from: string;
    /** The word in brackets after the name the copy starts with. */
    label?: string;
    /** What an entry is called, for the message when its name is taken, like "job". */
    noun: string;
    /** The names a copy cannot take. */
    existingNames: string[];
    /** What the copy gets and what is left to do, one sentence each. */
    facts: CloneFact[];
    /** The main button, which names what it makes, like "Clone job". */
    confirmLabel: string;
    icon?: LucideIcon;
    isLoading?: boolean;
    onConfirm: (name: string) => Promise<void>;
    onClose: () => void;
}

/**
 * Makes a copy of a job or a connection under a new name, in the blue of adding. It starts with a
 * name that is free and selected, so Enter clones right away and typing replaces it. The caller
 * mounts it while there is something to copy, so every copy starts from its own name.
 */
export function CloneDialog({ title, from, label = "Copy", noun, existingNames, facts, confirmLabel, icon = Copy, isLoading = false, onConfirm, onClose }: CloneDialogProps) {
    const [name, setName] = useState(() => freeCopyName(from, label, existingNames));
    const field = useRef<HTMLInputElement>(null);
    const nameId = useId();
    const trimmed = name.trim();
    const taken = existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase());

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!trimmed || taken || isLoading) return;
        await onConfirm(trimmed);
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                tone="create"
                showCloseButton={false}
                className={DIALOG_SURFACE}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    field.current?.focus();
                    field.current?.select();
                }}
            >
                <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
                    <DialogHead tone="create" icon={icon}>
                        <DialogTitle className="text-base">{title}</DialogTitle>
                        <DialogDescription className={cn(dialogNoteClass("create"), "truncate")}>From {from}</DialogDescription>
                    </DialogHead>

                    <ScrollArea className={BODY_SCROLL}>
                        <div className="space-y-5 p-5">
                            <div className="space-y-2">
                                <Label htmlFor={nameId}>Name</Label>
                                <Input
                                    ref={field}
                                    id={nameId}
                                    value={name}
                                    onChange={(event) => setName(event.target.value)}
                                    disabled={isLoading}
                                    autoComplete="off"
                                    aria-invalid={taken ? true : undefined}
                                    aria-describedby={taken ? `${nameId}-message` : undefined}
                                />
                                {taken && (
                                    <p id={`${nameId}-message`} className="text-sm text-destructive">
                                        A {noun} by this name exists already.
                                    </p>
                                )}
                            </div>
                            {facts.length > 0 && (
                                <ul className="grid gap-3 text-sm text-muted-foreground">
                                    {facts.map((fact) => (
                                        <li key={fact.text} className="flex gap-3">
                                            <fact.icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                                            {fact.text}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </ScrollArea>

                    <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                        <DialogClose asChild>
                            <Button type="button" variant="ghost">Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={isLoading || !trimmed || taken}>
                            {isLoading && <Loader2 className="animate-spin" />}
                            {confirmLabel}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
