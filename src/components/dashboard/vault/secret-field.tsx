"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { COPY_FAILED, copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/** Puts a value on the clipboard and says in a toast whether it arrived. */
export function copyText(text: string, what: string) {
    void copyToClipboard(text).then((copied) => (copied ? toast.success(`${what} copied`) : toast.error(COPY_FAILED)));
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
