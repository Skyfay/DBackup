"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * One labelled input of a credential profile. A secret one is masked and carries its own eye,
 * so revealing a password does not reveal every other secret of the form with it.
 * Shared by the credential dialog and the SSH key fields it delegates to.
 */
export function CredentialField({
    label,
    value,
    onChange,
    secret = false,
    placeholder,
    hint,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    secret?: boolean;
    placeholder?: string;
    /** A short note beside the label, like "Optional". */
    hint?: string;
}) {
    const id = useId();
    const [shown, setShown] = useState(false);

    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={id}>{label}</Label>
                {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
            </div>
            <div className="relative">
                <Input
                    id={id}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    type={secret && !shown ? "password" : "text"}
                    placeholder={placeholder}
                    // Keeps the browser from filling in the user's own DBackup login.
                    autoComplete={secret ? "new-password" : "off"}
                    className={cn(secret && "pr-10")}
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
        </div>
    );
}
