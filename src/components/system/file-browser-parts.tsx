"use client";

import { Eye, EyeOff, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER } from "@/components/ui/confirm-dialog";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/** Narrows the list to the names that contain the text. */
export function FileBrowserFilter({ value, onChange, label = "Filter this folder" }: { value: string; onChange: (value: string) => void; label?: string }) {
    return (
        <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input placeholder={label} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 pl-8" autoComplete="off" />
        </div>
    );
}

/** A fixed height, so the dialog does not jump from folder to folder. */
export function FileBrowserScroll({ children }: { children: React.ReactNode }) {
    return (
        <ScrollArea className="*:data-[slot=scroll-area-viewport]:h-[min(24rem,calc(95dvh-22rem))]">
            <div className="px-3 py-1.5">{children}</div>
        </ScrollArea>
    );
}

interface HiddenToggleProps {
    count: number;
    shown: boolean;
    onToggle: () => void;
    /** What the button says, by default about hidden files. */
    labels?: { show: string; hide: string };
}

/** Brings back the entries left out by default, like the ones whose name starts with a dot. Nothing while there are none. */
export function HiddenToggle({ count, shown, onToggle, labels = { show: `Show ${count} hidden`, hide: "Hide hidden files" } }: HiddenToggleProps) {
    if (count === 0 && !shown) return <span />;
    return (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" aria-pressed={shown} onClick={onToggle}>
            {shown ? <EyeOff /> : <Eye />}
            {shown ? labels.hide : labels.show}
        </Button>
    );
}

interface FileBrowserFooterProps {
    /** What the button hands back, as the reader knows it. Nothing keeps the button off. */
    chosen: string | null;
    /** Like "Use this folder". */
    action: string;
    disabled?: boolean;
    onUse: () => void;
    /** The line above what is picked, like "3 picked, 1 new". */
    label?: string;
    /** A path is cut from the start, so its end stays in view. A list of names is cut at its end. */
    cut?: "start" | "end";
}

/** What is picked above the buttons. */
export function FileBrowserFooter({ chosen, action, disabled = false, onUse, label = "Picked", cut = "start" }: FileBrowserFooterProps) {
    return (
        <div className={cn(DIALOG_FOOTER, "flex items-center gap-3")}>
            <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{label}</p>
                {chosen ? (
                    <p className={cn("truncate text-left text-sm font-medium", cut === "start" && "[direction:rtl]")} title={chosen}>
                        <bdi>{chosen}</bdi>
                    </p>
                ) : (
                    <p className="text-sm text-muted-foreground">Nothing picked yet</p>
                )}
            </div>
            <DialogClose asChild>
                <Button type="button" variant="ghost">
                    Cancel
                </Button>
            </DialogClose>
            <Button type="button" disabled={!chosen || disabled} onClick={onUse}>
                {action}
            </Button>
        </div>
    );
}
