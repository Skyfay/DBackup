"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { exampleTaskFor, templateExample } from "@/lib/auth/api-key-templates";
import { COPY_FAILED, copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export interface CreatedKey {
    name: string;
    rawKey: string;
    /** The task it was made for, which picks the example. */
    templateId: string | null;
    /** What the key may do, which picks the example when it was made without a task. */
    permissions: string[];
    /** A rotation handed out a new secret for a key that exists. */
    rotated?: boolean;
}

/**
 * The secret of a new or rotated key, shown once in the warning tone like every secret in the
 * clear, with Copy and a first request for its task that has the key in it.
 */
export function ApiKeyCreatedDialog({ created, onClose }: { created: CreatedKey; onClose: () => void }) {
    const [copied, setCopied] = useState(false);
    const example = templateExample(created.templateId ?? exampleTaskFor(created.permissions), typeof window === "undefined" ? "" : window.location.origin, created.rawKey);

    const copy = async () => {
        if (!(await copyToClipboard(created.rawKey))) {
            toast.error(COPY_FAILED);
            return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent tone="warning" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-2xl")}>
                <DialogHead tone="warning" icon={KeyRound}>
                    <DialogTitle className="truncate text-base">{created.rotated ? `${created.name} has a new secret` : `${created.name} is ready`}</DialogTitle>
                    <DialogDescription className={dialogNoteClass("warning")}>Copy it now, DBackup shows it only this once</DialogDescription>
                </DialogHead>

                <div className="min-w-0 space-y-4 p-5">
                    <p className="text-sm">
                        {created.rotated ? "The old secret stopped working. " : ""}
                        DBackup keeps only a hash of the key, so it cannot show it again. Put it into the secrets of whatever calls the API.
                    </p>
                    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-warning/35 bg-warning/5 p-2 pl-3">
                        <code className="min-w-0 flex-1 truncate font-mono text-sm" title={created.rawKey}>{created.rawKey}</code>
                        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                            {copied ? <Check /> : <Copy />}
                            {copied ? "Copied" : "Copy"}
                        </Button>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium">Try it</h3>
                        <CodeBlock name={example.name} code={example.code} language="bash" mark={{ text: created.rawKey, tone: "success" }} />
                        <p className="text-xs text-muted-foreground">Examples in Python, Go or a pipeline are in the API trigger of every job.</p>
                    </div>
                </div>

                <div className={cn(DIALOG_FOOTER, "flex items-center justify-end")}>
                    <Button type="button" onClick={onClose}>I copied it</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
