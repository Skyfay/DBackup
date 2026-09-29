"use client";

import { useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Letters and digits nobody mixes up when reading them out, so no l and 1 or O and 0. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function generatePassword(length = 16): string {
    const values = crypto.getRandomValues(new Uint32Array(length));
    return Array.from(values, (value) => ALPHABET[value % ALPHABET.length]).join("");
}

interface PasswordFieldProps extends Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> {
    value: string;
    onChange: (value: string) => void;
}

/** A password with Show and Generate. A generated password shows at once, so it can be handed on. */
export function PasswordField({ value, onChange, className, ...props }: PasswordFieldProps) {
    const [visible, setVisible] = useState(false);
    return (
        <div className="relative">
            <Input
                {...props}
                type={visible ? "text" : "password"}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                className={cn("pr-36", visible && value && "font-mono", className)}
            />
            <div className="absolute inset-y-0 right-1 flex items-center gap-1">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setVisible((current) => !current)}
                    aria-label={visible ? "Hide the password" : "Show the password"}
                >
                    {visible ? <EyeOff /> : <Eye />}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={() => {
                        onChange(generatePassword());
                        setVisible(true);
                    }}
                >
                    <RefreshCw className="size-3.5" />
                    Generate
                </Button>
            </div>
        </div>
    );
}
