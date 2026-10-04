"use client";

import { Fingerprint, KeyRound, Shield, ShieldCheck, ShieldOff } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { getOidcProviderIcon } from "@/components/oidc/provider-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { describeAgent, formatIpAddress } from "@/lib/core/user-agent";
import { cn } from "@/lib/utils";
import type { SecondFactor, SignInMethod, UserGroupRef, UserRow } from "@/services/user/users-types";

/** "LG" for Lena Graf, "M" for Manu. */
export function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    const letters = parts.length === 1 ? parts[0].charAt(0) : parts[0].charAt(0) + parts[parts.length - 1].charAt(0);
    return letters.toUpperCase();
}

const AVATAR_SIZES = { sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-11 text-sm" } as const;

export function UserAvatar({ user, size = "md" }: { user: Pick<UserRow, "name" | "image">; size?: keyof typeof AVATAR_SIZES }) {
    return (
        <Avatar className={cn("border", AVATAR_SIZES[size])}>
            {user.image && <AvatarImage src={user.image} alt="" />}
            <AvatarFallback className="bg-muted font-semibold">{initialsOf(user.name)}</AvatarFallback>
        </Avatar>
    );
}

/** A small mark after the name of the viewer's own row. */
export function YouTag() {
    return <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">You</span>;
}

/** Avatar, name and email. The name is a button, the way in for keyboards. */
export function UserCell({ user, compact, onOpen }: { user: UserRow; compact: boolean; onOpen: (user: UserRow) => void }) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <UserAvatar user={user} size={compact ? "sm" : "md"} />
            <div className={cn("min-w-0 max-w-72", compact && "flex items-baseline gap-2")}>
                <div className="flex min-w-0 items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => onOpen(user)}
                        title={user.name}
                        className="block min-w-0 truncate rounded-sm text-left font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        {user.name}
                    </button>
                    {user.isYou && <YouTag />}
                </div>
                <div className="min-w-0 truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
        </div>
    );
}

/** The group as a tag, or a dashed amber "No group", since such a user sees nothing. */
export function GroupTag({ group, className }: { group: UserGroupRef | null; className?: string }) {
    return (
        <span
            className={cn(
                "inline-flex h-5.5 max-w-40 items-center truncate rounded-md border px-2 text-xs font-medium",
                !group && "border-dashed border-warning/60 text-warning",
                className
            )}
            title={group ? group.name : "Signs in, but sees and does nothing until someone picks a group"}
        >
            {group ? group.name : "No group"}
        </span>
    );
}

export function methodIcon(method: SignInMethod) {
    if (method.kind === "password") return KeyRound;
    if (method.kind === "passkey") return Fingerprint;
    return getOidcProviderIcon(method.adapterId);
}

export function methodName(method: SignInMethod): string {
    if (method.kind === "password") return "Password";
    if (method.kind === "passkey") return method.count === 1 ? "Passkey" : `${method.count} passkeys`;
    return method.name;
}

/** A tile per way to sign in, then their names. */
export function MethodsCell({ methods, className }: { methods: SignInMethod[]; className?: string }) {
    if (methods.length === 0) return <span className="text-sm text-muted-foreground">No way to sign in</span>;
    return (
        <span className={cn("flex min-w-0 items-center gap-2", className)}>
            <span className="flex shrink-0 gap-1" aria-hidden="true">
                {methods.map((method) => {
                    const Icon = methodIcon(method);
                    return (
                        <span key={method.kind === "sso" ? method.providerId : method.kind} className="flex size-6 items-center justify-center rounded-md bg-muted">
                            <Icon className="size-3.5" />
                        </span>
                    );
                })}
            </span>
            <span className="min-w-0 truncate text-sm text-muted-foreground">{methods.map(methodName).join(", ")}</span>
        </span>
    );
}

const SECOND_FACTOR: Record<SecondFactor, { label: string; title: string }> = {
    passkey: { label: "Passkey", title: "A passkey after the password" },
    app: { label: "App", title: "A code from an authenticator app after the password" },
    sso: { label: "Via SSO", title: "Signs in only through SSO, where the provider decides" },
    none: { label: "Off", title: "The password alone signs in" },
    "no-password": { label: "No password", title: "Signs in without a password" },
};

export function secondFactorLabel(value: SecondFactor): string {
    return SECOND_FACTOR[value].label;
}

/** Green for a second factor DBackup asks for, gray for the rest. */
export function SecondFactorCell({ value }: { value: SecondFactor }) {
    const Icon = value === "passkey" || value === "app" ? ShieldCheck : value === "none" ? ShieldOff : Shield;
    return (
        <span className={cn("flex items-center gap-1.5 text-sm whitespace-nowrap", value === "passkey" || value === "app" ? "text-foreground" : "text-muted-foreground")} title={SECOND_FACTOR[value].title}>
            <Icon className={cn("size-3.5 shrink-0", (value === "passkey" || value === "app") && "text-success")} aria-hidden="true" />
            {SECOND_FACTOR[value].label}
        </span>
    );
}

/** "Firefox on macOS", or the address when the browser is not known. */
export function whereFrom(signIn: UserRow["lastSignIn"]): string | null {
    if (!signIn) return null;
    return (signIn.agent && describeAgent(signIn.agent)) || (signIn.ip ? formatIpAddress(signIn.ip) : null);
}

/** When the user last signed in and with what, or when they were made if they never did. */
export function LastSignInCell({ user }: { user: UserRow }) {
    if (!user.lastSignIn) {
        return (
            <div className="min-w-0 text-sm">
                <div className="text-muted-foreground">never</div>
                <div className="truncate text-xs text-muted-foreground">
                    created <RelativeTime date={user.createdAt} />
                </div>
            </div>
        );
    }
    const where = whereFrom(user.lastSignIn);
    return (
        <div className="min-w-0 text-sm">
            <RelativeTime date={user.lastSignIn.at} className="whitespace-nowrap" />
            {where && <div className="truncate text-xs text-muted-foreground">{where}</div>}
        </div>
    );
}

/** A count that is quiet at zero. */
export function CountCell({ value }: { value: number }) {
    return <div className={cn("text-right text-sm tabular-nums", value === 0 && "text-muted-foreground")}>{value.toLocaleString()}</div>;
}
