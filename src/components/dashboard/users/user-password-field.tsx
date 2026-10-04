"use client";

import { useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LEVEL_RULES, generatePassword, type PasswordOwner, type PasswordRules } from "@/lib/auth/password-policy";
import { cn } from "@/lib/utils";

interface PasswordFieldProps extends Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> {
    value: string;
    onChange: (value: string) => void;
    /** The rules of Settings > Passwords that Generate follows, the ones of Strong while they load. */
    rules: PasswordRules | null;
    /** Whose password it is, so Generate leaves out their name. */
    owner?: PasswordOwner;
}

/** A password with Show inside the field and Generate beside it. A generated password shows at once, so it can be handed on. */
export function PasswordField({ value, onChange, rules, owner, className, ...props }: PasswordFieldProps) {
    const [visible, setVisible] = useState(false);
    return (
        <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
                <Input
                    {...props}
                    type={visible ? "text" : "password"}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    autoComplete="new-password"
                    spellCheck={false}
                    className={cn("pr-10", visible && value && "font-mono", className)}
                />
                <div className="absolute inset-y-0 right-1 flex items-center">
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
                </div>
            </div>
            <Button
                type="button"
                variant="outline"
                onClick={() => {
                    onChange(generatePassword(rules ?? LEVEL_RULES.strong, owner));
                    setVisible(true);
                }}
            >
                <RefreshCw />
                Generate
            </Button>
        </div>
    );
}
