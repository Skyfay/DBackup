"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/** Puts a value on the clipboard, which a page served over plain HTTP may not reach. */
export function copyText(text: string, what: string) {
    if (!navigator.clipboard) {
        toast.error("The clipboard is only open to pages served over HTTPS.");
        return;
    }
    navigator.clipboard
        .writeText(text)
        .then(() => toast.success(`${what} copied`))
        .catch(() => toast.error(`${what} could not be copied`));
}

interface SecretFieldProps {
    label: string;
    value: string;
    /** Mono for keys, hashes and passwords, the plain font for a user name. */
    mono?: boolean;
    /** Leaves out Copy, like for a Key ID nobody pastes anywhere. */
    copy?: boolean;
}

/**
 * A revealed value with its label and Copy. A long one, like a private key, scrolls inside its box
 * instead of stretching the dialog.
 */
export function SecretField({ label, value, mono = true, copy = true }: SecretFieldProps) {
    const long = value.length > 160 || value.includes("\n");
    return (
        <div className="space-y-1.5">
            <div className="text-sm font-medium">{label}</div>
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 rounded-lg border bg-muted/40">
                    <ScrollArea className={cn(long && "*:data-[slot=scroll-area-viewport]:max-h-40")}>
                        <div className={cn("px-3 py-2 text-sm break-all whitespace-pre-wrap", mono && "font-mono text-xs leading-5")}>{value}</div>
                    </ScrollArea>
                </div>
                {copy && (
                    <Button type="button" variant="outline" size="icon" className="size-9 shrink-0" onClick={() => copyText(value, label)} aria-label={`Copy ${label.toLowerCase()}`}>
                        <Copy />
                    </Button>
                )}
            </div>
        </div>
    );
}
