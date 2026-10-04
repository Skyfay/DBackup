"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleCheck, FileKey, Import, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { importEncryptionProfile, inspectEncryptionKey } from "@/app/actions/backup/encryption";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import { keysFromFile, type KitKey } from "./kit-file";

const log = logger.child({ component: "import-key-dialog" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]";
const KEY_LENGTH = 64;

/** What the server said about the key in the field. */
type Inspection = { key: string; keyId: string; existing: { id: string; name: string } | null } | { key: string; error: string };

interface ImportKeyDialogProps {
    /** The names of the keys in the Vault, which a new key cannot take. */
    taken: string[];
    onClose: () => void;
    onImported: () => void;
}

/**
 * Brings a key into the Vault, typed or from the files of its recovery kit. Backups that name a
 * key the Vault lacks open with it once it fits, the restore finds it by itself.
 */
export function ImportKeyDialog({ taken, onClose, onImported }: ImportKeyDialogProps) {
    const [name, setName] = useState("");
    const [key, setKey] = useState("");
    const [description, setDescription] = useState("");
    const [problems, setProblems] = useState<{ name?: string; key?: string }>({});
    const [inspection, setInspection] = useState<Inspection | null>(null);
    const [choices, setChoices] = useState<KitKey[]>([]);
    // The id the key had in the install of its kit, while the field still holds that key.
    const [former, setFormer] = useState<{ key: string; profileId: string } | null>(null);
    const [dragging, setDragging] = useState(false);
    const [saving, setSaving] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const nameId = useId();
    const keyId = useId();
    const descriptionId = useId();

    const clean = key.replace(/\s+/g, "");
    const complete = /^[0-9a-fA-F]{64}$/.test(clean);
    const current = inspection && inspection.key === clean ? inspection : null;

    // The Key ID comes from the server, since a page served over plain HTTP has no hash function.
    useEffect(() => {
        if (!complete) return;
        let ignore = false;
        inspectEncryptionKey(clean)
            .then((result) => {
                if (ignore) return;
                setInspection(result.success ? { key: clean, ...result.data } : { key: clean, error: result.error });
            })
            .catch((error: unknown) => {
                if (!ignore) log.warn("Inspecting a key failed", {}, wrapError(error));
            });
        return () => {
            ignore = true;
        };
    }, [clean, complete]);

    const pickKey = (entry: KitKey) => {
        setKey(entry.key);
        setFormer(entry.profileId ? { key: entry.key, profileId: entry.profileId } : null);
        setChoices([]);
        setProblems({});
        if (entry.name && !name.trim()) setName(taken.includes(entry.name) ? `${entry.name} (imported)` : entry.name);
    };

    const readFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            const keys = await keysFromFile(file);
            if (keys.length === 1) pickKey(keys[0]);
            else setChoices(keys);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "The file could not be read.");
        }
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();
        const next: typeof problems = {};
        if (!trimmed) next.name = "Give the key a name.";
        else if (taken.includes(trimmed)) next.name = "The Vault holds a key by this name already.";
        if (!complete) next.key = `A key is ${KEY_LENGTH} hex characters, this one has ${clean.length}.`;
        else if (current && "existing" in current && current.existing) next.key = `This key is in the Vault already, as ${current.existing.name}.`;
        setProblems(next);
        if (next.name || next.key) return;

        setSaving(true);
        try {
            const standsFor = former && former.key === clean ? [former.profileId] : [];
            const result = await importEncryptionProfile(trimmed, clean, description.trim() || undefined, standsFor);
            if (result.success) {
                toast.success("Key imported");
                onImported();
                return;
            }
            toast.error(result.error || "The key could not be imported.");
        } catch (error) {
            // Without the right to write to the Vault the action throws instead of answering.
            log.warn("Importing a key failed", {}, wrapError(error));
            toast.error("The key could not be imported.");
        }
        setSaving(false);
    };

    const keyHint = !complete
        ? `${clean.length} of ${KEY_LENGTH} characters`
        : current && "error" in current
            ? current.error
            : current?.existing
                ? `This key is in the Vault already, as ${current.existing.name}.`
                : current
                    ? `Key ID ${current.keyId}, a hex key of 256 bits`
                    : "Checking the key";

    return (
        <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
            <DialogContent tone="create" showCloseButton={false} className={DIALOG_SURFACE}>
                <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
                    <DialogHead tone="create" icon={Import}>
                        <DialogTitle className="text-base">Import key</DialogTitle>
                        <DialogDescription className={dialogNoteClass("create")}>From a recovery kit or another install</DialogDescription>
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
                                        setProblems((previous) => ({ ...previous, name: undefined }));
                                    }}
                                    maxLength={100}
                                    placeholder="Like Old production"
                                    autoComplete="off"
                                    aria-invalid={problems.name ? true : undefined}
                                />
                                {problems.name && <p className="text-sm text-destructive">{problems.name}</p>}
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-baseline justify-between gap-3">
                                    <Label htmlFor={keyId}>Key</Label>
                                    {complete && (
                                        <span className="flex items-center gap-1 text-xs text-success tabular-nums">
                                            <CircleCheck className="size-3.5" aria-hidden="true" />
                                            {KEY_LENGTH} of {KEY_LENGTH}
                                        </span>
                                    )}
                                </div>
                                <Textarea
                                    id={keyId}
                                    value={key}
                                    onChange={(event) => {
                                        setKey(event.target.value);
                                        setProblems((previous) => ({ ...previous, key: undefined }));
                                    }}
                                    rows={2}
                                    spellCheck={false}
                                    autoComplete="off"
                                    placeholder="The 64 hex characters of the key"
                                    className="min-h-0 resize-none font-mono text-xs break-all"
                                    aria-invalid={problems.key ? true : undefined}
                                    aria-describedby={`${keyId}-hint`}
                                />
                                <p
                                    id={`${keyId}-hint`}
                                    className={cn("text-xs", problems.key || (current && ("error" in current || current.existing)) ? "text-destructive" : "text-muted-foreground")}
                                >
                                    {problems.key ?? keyHint}
                                </p>
                            </div>

                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() => fileInput.current?.click()}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        fileInput.current?.click();
                                    }
                                }}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    setDragging(true);
                                }}
                                onDragLeave={() => setDragging(false)}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    setDragging(false);
                                    void readFile(event.dataTransfer.files[0]);
                                }}
                                className={cn(
                                    "flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
                                    dragging && "border-tone bg-tone/5"
                                )}
                            >
                                <FileKey className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium">Or drop the key file of its recovery kit</p>
                                    <p className="text-xs text-muted-foreground">master.key or keys/Name.key from the .zip, or the whole .zip</p>
                                </div>
                                <input
                                    ref={fileInput}
                                    type="file"
                                    accept=".key,.zip,.txt"
                                    className="hidden"
                                    onChange={(event) => {
                                        void readFile(event.target.files?.[0]);
                                        event.target.value = "";
                                    }}
                                />
                            </div>

                            {choices.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-sm">This kit holds {choices.length} keys. Which one?</p>
                                    <div className="flex flex-wrap gap-2">
                                        {choices.map((choice) => (
                                            <Button key={choice.key} type="button" variant="outline" size="sm" onClick={() => pickKey(choice)}>
                                                {choice.name ?? `${choice.key.slice(0, 8)}…`}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor={descriptionId}>Description</Label>
                                <Input
                                    id={descriptionId}
                                    value={description}
                                    onChange={(event) => setDescription(event.target.value)}
                                    maxLength={500}
                                    placeholder="Optional, like where it came from"
                                    autoComplete="off"
                                />
                            </div>

                            <div className="flex gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span>Backups that name a key the Vault lacks open with this one when it fits. Jobs keep their own key.</span>
                            </div>
                        </div>
                    </ScrollArea>

                    <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                        <DialogClose asChild>
                            <Button type="button" variant="ghost" disabled={saving}>Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={saving}>
                            {saving ? <Loader2 className="animate-spin" /> : <Import />}
                            Import key
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
