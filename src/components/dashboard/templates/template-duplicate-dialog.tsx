"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CloneDialog, type CloneFact } from "@/components/ui/clone-dialog";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "TemplateDuplicateDialog" });

interface TemplateDuplicateDialogProps {
    /** The name of the template the copy is made from. */
    from: string;
    /** What a template of this kind is called, like "policy". */
    noun: string;
    existingNames: string[];
    facts: CloneFact[];
    /** Creates the copy under the name picked. */
    create: (name: string) => Promise<{ success: boolean; error?: string }>;
    onClose: () => void;
    onDone: () => void;
}

/** Makes a copy of a template under a new name, like Clone of a job. */
export function TemplateDuplicateDialog({ from, noun, existingNames, facts, create, onClose, onDone }: TemplateDuplicateDialogProps) {
    const [pending, setPending] = useState(false);

    const confirm = async (name: string) => {
        setPending(true);
        try {
            const result = await create(name);
            if (result.success) {
                toast.success(`${name} created`);
                onDone();
                return;
            }
            toast.error(result.error || `The ${noun} could not be duplicated.`);
        } catch (error: unknown) {
            // Without the right to write templates the action throws instead of answering.
            log.warn("A template could not be duplicated", { noun }, wrapError(error));
            toast.error(`The ${noun} could not be duplicated.`);
        } finally {
            setPending(false);
        }
    };

    return (
        <CloneDialog
            title={`Duplicate ${noun}`}
            from={from}
            noun={noun}
            existingNames={existingNames}
            facts={facts}
            confirmLabel={`Duplicate ${noun}`}
            isLoading={pending}
            onConfirm={confirm}
            onClose={onClose}
        />
    );
}
