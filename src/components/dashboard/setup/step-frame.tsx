"use client";

import { useId } from "react";
import { ChevronLeft, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { toneAttribute, type Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";

/**
 * The height of a step's body from md up. It is the height of the parts beside the list in the
 * connection form, so the card keeps its size while a step moves from the types to the form.
 */
const STEP_BODY_HEIGHT = "md:h-[min(32rem,calc(95dvh-9.5rem))]";

interface StepFrameProps {
    tone: Tone;
    icon: LucideIcon;
    title: string;
    /** The purpose of the step and where it stands, "What do you want to back up? · Step 1 of 5". */
    note: string;
    /** The left of the footer, usually the way back. */
    start?: React.ReactNode;
    /** The buttons on the right of the footer, the main one last. */
    end?: React.ReactNode;
    /** Makes the step a form, whose submit button sits in the footer. */
    onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
    /** The body keeps the height of the connection form. Off for a short step like the summary. */
    fill?: boolean;
    children: React.ReactNode;
}

/** One step of the setup: a tinted head in the tone of the task, the body and a strip of buttons. */
export function StepFrame({ tone, icon, title, note, start, end, onSubmit, fill = true, children }: StepFrameProps) {
    const titleId = useId();
    const className = "flex min-w-0 flex-1 flex-col";
    const content = (
        <>
            <DialogHead tone={tone} icon={icon}>
                <h2 id={titleId} className="text-base leading-none font-semibold">{title}</h2>
                <p className={cn(dialogNoteClass(tone), "truncate")}>{note}</p>
            </DialogHead>
            <div className={cn("flex min-h-0 flex-col", fill && STEP_BODY_HEIGHT)}>{children}</div>
            <div className={cn(DIALOG_FOOTER, "flex flex-wrap items-center justify-between gap-2")}>
                <div className="flex min-w-0 items-center gap-2">{start}</div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{end}</div>
            </div>
        </>
    );

    return onSubmit ? (
        <form {...toneAttribute(tone)} aria-labelledby={titleId} noValidate onSubmit={onSubmit} className={className}>
            {content}
        </form>
    ) : (
        <section {...toneAttribute(tone)} aria-labelledby={titleId} className={className}>
            {content}
        </section>
    );
}

export function BackButton({ onClick }: { onClick: () => void }) {
    return (
        <Button type="button" variant="ghost" onClick={onClick}>
            <ChevronLeft />
            Back
        </Button>
    );
}
