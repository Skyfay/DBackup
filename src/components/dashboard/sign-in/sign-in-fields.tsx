"use client";

import { useId, useState } from "react";
import { CircleCheck, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ProviderFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /** A line under the field. */
    description?: React.ReactNode;
    error?: string | null;
    /** Beside the label on the right, like "Optional" or whether the URL was found. */
    aside?: React.ReactNode;
    /** For values that are IDs, like the client ID. */
    mono?: boolean;
    /** Masked, with its own eye to show it. */
    secret?: boolean;
    type?: "text" | "url";
    onBlur?: () => void;
    autoFocus?: boolean;
}

/** One labelled field of a provider, like the credential fields: a secret one carries its own eye. */
export function ProviderField({ label, value, onChange, placeholder, description, error, aside, mono, secret, type = "text", onBlur, autoFocus }: ProviderFieldProps) {
    const id = useId();
    const [shown, setShown] = useState(false);
    return (
        <div className="space-y-2">
            <div className="flex min-w-0 items-baseline justify-between gap-3">
                <Label htmlFor={id}>{label}</Label>
                {aside}
            </div>
            <div className="relative">
                <Input
                    id={id}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    onBlur={onBlur}
                    type={secret && !shown ? "password" : type === "url" ? "url" : "text"}
                    placeholder={placeholder}
                    // Keeps the browser from filling in the user's own DBackup login.
                    autoComplete={secret ? "new-password" : "off"}
                    spellCheck={false}
                    autoFocus={autoFocus}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : description ? `${id}-note` : undefined}
                    className={cn(mono && "font-mono text-xs", secret && "pr-10")}
                />
                {secret && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
                        aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
                        aria-pressed={shown}
                        onClick={() => setShown((current) => !current)}
                    >
                        {shown ? <EyeOff /> : <Eye />}
                    </Button>
                )}
            </div>
            {error ? (
                <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>
            ) : (
                description && <p id={`${id}-note`} className="text-xs text-muted-foreground">{description}</p>
            )}
        </div>
    );
}

export const OptionalMark = () => <span className="text-xs text-muted-foreground">Optional</span>;

/** Whether the URL of a provider was reached, beside its label. */
export function FoundMark({ state }: { state: "checking" | "found" | "failed" | null }) {
    if (state === "checking") {
        return (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Checking
            </span>
        );
    }
    if (state === "found") {
        return (
            <span className="flex items-center gap-1 text-xs font-medium text-success">
                <CircleCheck className="size-3.5" aria-hidden="true" />
                Found
            </span>
        );
    }
    if (state === "failed") return <span className="text-xs font-medium text-destructive">Not reached</span>;
    return null;
}

interface SavedSecretProps {
    replacing: boolean;
    value: string;
    onReplace: (replacing: boolean) => void;
    onChange: (value: string) => void;
    error?: string | null;
}

/** The saved client secret, which the browser never gets: Replace swaps in a field for a new one. */
export function SavedSecretField({ replacing, value, onReplace, onChange, error }: SavedSecretProps) {
    if (replacing) {
        return (
            <ProviderField
                label="Client secret"
                value={value}
                onChange={onChange}
                secret
                autoFocus
                aside={
                    <button type="button" onClick={() => onReplace(false)} className="rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                        Keep the saved one
                    </button>
                }
                description="The new secret replaces the saved one when you save."
                error={error}
            />
        );
    }
    return (
        <div className="space-y-2">
            <span className="text-sm leading-none font-medium">Client secret</span>
            <div className="flex h-9 items-center gap-2.5 rounded-md border border-dashed pr-1 pl-3">
                <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">Saved, never shown again</span>
                <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => onReplace(true)}>
                    Replace
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">DBackup keeps it encrypted and never sends it to the browser.</p>
        </div>
    );
}
