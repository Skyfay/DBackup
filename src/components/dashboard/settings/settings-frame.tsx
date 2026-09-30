"use client";

import { createContext, useContext, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { SaveResult } from "@/lib/settings/save-part";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import { partOf, type SettingsPartId } from "./settings-parts";

const log = logger.child({ component: "settings-frame" });

/**
 * What the page tells its parts: whether the viewer may change anything, where unsaved changes go
 * and what each part is called. Settings and Profile both build on it, each with its own parts.
 */
interface SettingsFrameContextValue {
    readOnly: boolean;
    /** A part reports whether it holds changes that are not saved, so leaving it asks first. */
    setDirty: (part: string, dirty: boolean) => void;
    /** The title and the line of a part. */
    describe?: (part: string) => { label: string; description: string };
}

export const SettingsFrameContext = createContext<SettingsFrameContextValue>({ readOnly: false, setDirty: () => {} });

/** The title and the line of a part, from the page it sits on, the Settings page by default. */
function useDescribe(): (part: string) => { label: string; description: string } {
    return useSettingsFrame().describe ?? ((part) => partOf(part as SettingsPartId));
}

export function useSettingsFrame(): SettingsFrameContextValue {
    return useContext(SettingsFrameContext);
}

interface PartFrameProps {
    part: string;
    /** Buttons on the right of the head, like Back up now. */
    action?: React.ReactNode;
    /** The body fills the pane without padding, like a table. */
    flush?: boolean;
    children: React.ReactNode;
}

/** The open part: its title and line on top, a note for a viewer who may only read, then its body. */
export function PartFrame({ part, action, flush = false, children }: PartFrameProps) {
    const { readOnly } = useSettingsFrame();
    const { label, description } = useDescribe()(part);
    return (
        <section aria-labelledby={`settings-${part}`} className="min-w-0 flex-1">
            <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start md:px-6 md:py-5">
                <div className="min-w-0 flex-1">
                    <h2 id={`settings-${part}`} className="font-semibold">{label}</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                </div>
                {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
            </div>
            {readOnly && (
                <p className="mx-4 mt-4 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm md:mx-6">
                    <LockKeyhole className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    You may look at the settings. Changing them needs a group that may change the settings.
                </p>
            )}
            {flush ? children : <div className="max-w-3xl space-y-6 px-4 py-5 md:px-6">{children}</div>}
        </section>
    );
}

interface FieldProps {
    label: string;
    /** The `data-setting` the search marks. */
    setting: string;
    hint?: React.ReactNode;
    error?: string | null;
    className?: string;
    children: (id: string) => React.ReactNode;
}

/** A setting with its label on top and a line under it, which the search can mark. */
export function Field({ label, setting, hint, error, className, children }: FieldProps) {
    const id = useId();
    return (
        <div data-setting={setting} className={cn("min-w-0 space-y-2 rounded-lg", className)}>
            <Label htmlFor={id}>{label}</Label>
            {children(id)}
            {error ? <p className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
    );
}

/** One changed setting, as the save bar names it. */
export interface PartChange {
    label: string;
    from: string;
    to: string;
}

interface SaveBarProps {
    changes: PartChange[];
    saving: boolean;
    onDiscard: () => void;
    onSave: () => void;
}

/**
 * Stays at the foot while the part scrolls, as long as it holds changes: how many and which, with
 * Discard and Save changes. Nothing is saved before Save changes.
 */
export function SaveBar({ changes, saving, onDiscard, onSave }: SaveBarProps) {
    if (changes.length === 0) return null;
    const detail = changes.map((change) => `${change.label} ${change.from} to ${change.to}`).join(" · ");
    return (
        <div className="sticky bottom-3 z-20 mx-3 mb-3 flex flex-wrap items-center gap-3 rounded-xl border bg-raised px-4 py-3 shadow-lg md:bottom-4 md:mx-4 md:mb-4">
            <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground sm:flex" aria-hidden="true">
                <Pencil className="size-4" />
            </span>
            <div className="min-w-0 flex-1" role="status">
                <p className="text-sm font-semibold">{changes.length === 1 ? "1 change" : `${changes.length} changes`}</p>
                <p className="truncate text-xs text-muted-foreground" title={detail}>{detail}</p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
                <Button variant="outline" className="flex-1 sm:flex-none" onClick={onDiscard} disabled={saving}>
                    Discard
                </Button>
                <Button className="flex-1 sm:flex-none" onClick={onSave} disabled={saving}>
                    {saving && <Loader2 className="animate-spin" />}
                    Save changes
                </Button>
            </div>
        </div>
    );
}

/**
 * The values of a part against what is saved: `set` changes one, `discard` goes back, and the
 * page learns about unsaved changes. `saved` from the server replaces the values once they are
 * saved, never while someone is editing.
 */
export function usePartValues<T extends object>(part: string, saved: T) {
    const { setDirty } = useSettingsFrame();
    const [base, setBase] = useState(saved);
    const [values, setValues] = useState(saved);
    const dirty = JSON.stringify(values) !== JSON.stringify(base);

    // A save or a change elsewhere reloads the page. The part takes it over unless it holds changes.
    const savedKey = JSON.stringify(saved);
    useEffect(() => {
        if (dirty) return;
        const next = JSON.parse(savedKey) as T;
        setBase(next);
        setValues(next);
        // Only a new saved state counts, the values being edited must not trigger it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [savedKey]);

    useEffect(() => {
        setDirty(part, dirty);
    }, [part, dirty, setDirty]);
    useEffect(() => () => setDirty(part, false), [part, setDirty]);

    return {
        base,
        values,
        dirty,
        set: <K extends keyof T>(key: K, value: T[K]) => setValues((current) => ({ ...current, [key]: value })),
        replace: setValues,
        discard: () => setValues(base),
        /** After a save, the values are what is saved now. */
        commit: () => setBase(values),
    };
}

/**
 * Saves a part with its action: one toast for the save, the page loaded again, and a problem of
 * a field kept, so the field can show it.
 */
export function usePartSave(part: string) {
    const router = useRouter();
    const describe = useDescribe();
    const [saving, setSaving] = useState(false);
    const [problem, setProblem] = useState<{ field?: string; message: string } | null>(null);

    const run = async (save: () => Promise<SaveResult>, onSaved: () => void) => {
        setSaving(true);
        setProblem(null);
        try {
            const result = await save();
            if (!result.success) {
                setProblem({ field: result.field, message: result.error });
                toast.error(result.error);
                return;
            }
            onSaved();
            toast.success(`${describe(part).label} saved`);
            router.refresh();
        } catch (error: unknown) {
            // Without the right to change the settings the actions throw instead of answering.
            log.warn("Saving settings failed", { part }, wrapError(error));
            toast.error("The settings could not be saved.");
        } finally {
            setSaving(false);
        }
    };

    return {
        saving,
        run,
        /** The problem of a field, as the service named it. */
        errorOf: (field: string) => (problem?.field === field ? problem.message : null),
        clearProblem: () => setProblem(null),
    };
}
