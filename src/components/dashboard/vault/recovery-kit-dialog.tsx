"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, Package, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { VaultKey } from "@/services/vault/vault-types";
import { downloadRecoveryKit } from "./kit-download";
import { KeyTile } from "./vault-cells";
import { count, keyUse } from "./vault-format";

/** From this many keys on the list gets a search. */
const SEARCH_FROM = 7;

interface RecoveryKitDialogProps {
    keys: VaultKey[];
    /** The keys ticked when it opens, every key when left out. */
    picked?: string[];
    onClose: () => void;
    /** After the kit was downloaded, with the keys it held. */
    onDownloaded: (ids: string[]) => void;
}

/**
 * Puts any keys into one recovery kit. A backup names the key that encrypted it, so the tool of the
 * kit finds the right one by itself and one kit with every key is the useful default. Unticking is
 * there for a kit that only opens what its holder should see.
 */
export function RecoveryKitDialog({ keys, picked, onClose, onDownloaded }: RecoveryKitDialogProps) {
    const [selected, setSelected] = useState<Set<string>>(() => new Set(picked ?? keys.map((key) => key.id)));
    const [search, setSearch] = useState("");
    const [pending, setPending] = useState(false);

    const shown = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return needle ? keys.filter((key) => key.name.toLowerCase().includes(needle)) : keys;
    }, [keys, search]);
    const allShown = shown.length > 0 && shown.every((key) => selected.has(key.id));
    const someShown = shown.some((key) => selected.has(key.id));

    const toggle = (id: string) =>
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const toggleShown = () =>
        setSelected((current) => {
            const next = new Set(current);
            for (const key of shown) {
                if (allShown) next.delete(key.id);
                else next.add(key.id);
            }
            return next;
        });

    const download = async () => {
        const ids = keys.filter((key) => selected.has(key.id)).map((key) => key.id);
        setPending(true);
        const done = await downloadRecoveryKit(ids);
        setPending(false);
        if (done) onDownloaded(ids);
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
            <DialogContent showCloseButton={false} className={DIALOG_SURFACE}>
                <DialogHead tone="neutral" icon={Package}>
                    <DialogTitle className="text-base">Recovery kit</DialogTitle>
                    <DialogDescription className={dialogNoteClass("neutral")}>Restores backups without DBackup</DialogDescription>
                </DialogHead>

                <div className="grid min-w-0 gap-3 p-5">
                    <p className="text-sm">Pick the keys it holds. Its tool finds the right key for each backup by itself.</p>
                    {keys.length >= SEARCH_FROM && (
                        <div className="relative">
                            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search keys" className="pl-8" aria-label="Search keys" />
                        </div>
                    )}
                    <div className="min-w-0 overflow-clip rounded-lg border">
                        <label className="flex cursor-pointer items-center gap-3 border-b bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                            <Checkbox checked={allShown ? true : someShown ? "indeterminate" : false} onCheckedChange={toggleShown} aria-label="Pick every key shown" />
                            <span className="tabular-nums">{selected.size} of {count(keys.length, "key")}</span>
                        </label>
                        <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[min(18rem,calc(95dvh-22rem))]">
                            <ul className="divide-y">
                                {shown.map((key) => (
                                    <li key={key.id}>
                                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
                                            <Checkbox checked={selected.has(key.id)} onCheckedChange={() => toggle(key.id)} aria-label={key.name} />
                                            <KeyTile size="sm" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-medium">{key.name}</span>
                                                <span className={cn("block truncate text-xs", key.kit ? "text-muted-foreground" : "text-warning")}>
                                                    {keyUse(key)} · {key.kit ? "in a kit" : "never in a kit"}
                                                </span>
                                            </span>
                                        </label>
                                    </li>
                                ))}
                                {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">No key by that name.</li>}
                            </ul>
                        </ScrollArea>
                    </div>
                    {selected.size > 0 && (
                        <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm">
                            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                            <span>
                                It opens every backup made with {selected.size === 1 ? "this key" : `these ${selected.size} keys`}. Keep it away from your backups.
                            </span>
                        </div>
                    )}
                </div>

                <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                    <DialogClose asChild>
                        <Button variant="outline" disabled={pending}>Cancel</Button>
                    </DialogClose>
                    <Button onClick={download} disabled={pending || selected.size === 0}>
                        {pending ? <Loader2 className="animate-spin" /> : <Download />}
                        {selected.size > 1 ? `Download ${selected.size} keys` : "Download kit"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
