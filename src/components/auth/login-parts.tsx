"use client";

import { useState } from "react";
import { AlertCircle, ArrowLeft, Eye, EyeOff, Fingerprint, Loader2 } from "lucide-react";
import { ProviderLogo } from "@/components/oidc/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LoginProvider } from "@/services/auth/login-page-service";

/** The title of a step of the login page and the line under it. */
export function LoginHeading({ title, sub }: { title: string; sub?: React.ReactNode }) {
    return (
        <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {sub && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{sub}</p>}
        </div>
    );
}

/** The heading of a step with a way back, like the steps of the first start. */
export function BackHeading({ title, sub, onBack, backLabel = "Back to the start" }: { title: string; sub: string; onBack: () => void; backLabel?: string }) {
    return (
        <div className="flex items-start gap-3">
            <Button type="button" variant="ghost" size="icon-sm" className="mt-0.5 shrink-0" onClick={onBack} aria-label={backLabel}>
                <ArrowLeft />
            </Button>
            <div className="min-w-0 flex-1">
                <LoginHeading title={title} sub={sub} />
            </div>
        </div>
    );
}

export function OrDivider({ label = "or" }: { label?: string }) {
    return (
        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            {label}
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
        </div>
    );
}

/** What went wrong, on top of the step, where it stays until the next try. */
export function LoginNote({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div role="alert" className="mb-5 flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0">
                <p className="text-sm font-medium">{title}</p>
                <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{children}</div>
            </div>
        </div>
    );
}

export function ProviderButton({ provider, onClick, disabled }: { provider: LoginProvider; onClick: () => void; disabled?: boolean }) {
    return (
        <Button type="button" variant="outline" size="lg" className="w-full" onClick={onClick} disabled={disabled}>
            <ProviderLogo adapterId={provider.adapterId} className="size-4.5" />
            Continue with {provider.name}
        </Button>
    );
}

export function PasskeyButton({ label = "Sign in with a passkey", onClick, disabled, busy }: { label?: string; onClick: () => void; disabled?: boolean; busy?: boolean }) {
    return (
        <Button type="button" variant="outline" size="lg" className="w-full" onClick={onClick} disabled={disabled}>
            {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />}
            {label}
        </Button>
    );
}

export function ForgotHint() {
    return (
        <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
            Forgot your password? An admin of this DBackup resets it under Users &amp; Groups.
        </p>
    );
}

/** A password field with a button that shows what was typed. */
export function PasswordInput({ className, ...props }: React.ComponentProps<typeof Input>) {
    const [shown, setShown] = useState(false);
    return (
        <div className="relative">
            <Input {...props} type={shown ? "text" : "password"} className={cn("h-10 pr-10", className)} />
            <button
                type="button"
                onClick={() => setShown((current) => !current)}
                aria-label={shown ? "Hide the password" : "Show the password"}
                aria-pressed={shown}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
                {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
        </div>
    );
}
