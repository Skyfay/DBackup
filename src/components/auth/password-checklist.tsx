"use client";

import { Circle, CircleCheck } from "lucide-react";
import { checkPassword, type PasswordOwner, type PasswordRules } from "@/lib/auth/password-policy";
import { cn } from "@/lib/utils";

interface PasswordChecklistProps {
    rules: PasswordRules;
    password: string;
    /** Whose password it is, for the rule that it may not hold their name or email. */
    owner?: PasswordOwner;
    className?: string;
}

/**
 * What a new password needs under its field, one line per rule of Settings > Passwords, ticked in
 * green once it holds. The length says how far it is while it is too short.
 */
export function PasswordChecklist({ rules, password, owner, className }: PasswordChecklistProps) {
    return (
        <ul aria-label="What the password needs" className={cn("grid gap-x-4 gap-y-1.5 sm:grid-cols-2", className)}>
            {checkPassword(password, rules, owner).map((check) => (
                <li key={check.id} className={cn("flex min-w-0 items-center gap-1.5 text-xs", check.met ? "text-foreground" : "text-muted-foreground")}>
                    {check.met ? (
                        <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                    ) : (
                        <Circle className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                    )}
                    <span>
                        {check.label}
                        {check.id === "length" && !check.met && password.length > 0 && ` · ${password.length} now`}
                    </span>
                    <span className="sr-only">{check.met ? ", done" : ", still missing"}</span>
                </li>
            ))}
        </ul>
    );
}
