"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { formatTwoFactorCode } from "@/lib/utils";
import { LoginHeading, LoginNote, OrDivider, PasskeyButton } from "./login-parts";
import { codeError, type AuthError, type LoginProblem } from "./login-problems";

const log = logger.child({ component: "second-factor-step" });

interface SecondFactorStepProps {
    email: string;
    onBack: () => void;
    onPasskey: () => void;
    passkeyBusy: boolean;
    /** A passkey that failed, from the form around. */
    problem?: LoginProblem | null;
}

/** The second factor after the password: the code of the authenticator app, a backup code or a passkey. */
export function SecondFactorStep({ email, onBack, onPasskey, passkeyBusy, problem }: SecondFactorStepProps) {
    const router = useRouter();
    const codeId = useId();
    const [backup, setBackup] = useState(false);
    const [code, setCode] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const complete = backup ? code.trim().length >= 8 : code.length === 6;

    const verify = async () => {
        if (!complete || busy) return;
        setBusy(true);
        setError(null);
        const fetchOptions = {
            onSuccess: () => router.push("/dashboard"),
            onError: (context: { error: AuthError }) => {
                setError(codeError(context.error, backup));
                setBusy(false);
            },
        };
        try {
            if (backup) await authClient.twoFactor.verifyBackupCode({ code: code.trim(), fetchOptions });
            else await authClient.twoFactor.verifyTotp({ code, fetchOptions });
        } catch (failure: unknown) {
            log.error("Two-factor verification failed", {}, wrapError(failure));
            setError("The code could not be checked. Try again.");
            setBusy(false);
        }
    };

    const switchKind = () => {
        setBackup((current) => !current);
        setCode("");
        setError(null);
    };

    return (
        <div className="w-full max-w-sm">
            <span className="mb-5 flex size-10 items-center justify-center rounded-lg border bg-muted" aria-hidden="true">
                <ShieldCheck className="size-4.5" />
            </span>
            <LoginHeading
                title="Confirm it is you"
                sub={backup ? `Enter one of the backup codes you saved for ${email}.` : `Enter the 6-digit code of your authenticator app for ${email}.`}
            />
            {problem && <LoginNote title={problem.title}>{problem.text}</LoginNote>}
            <form
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    void verify();
                }}
                className="space-y-4"
            >
                <div className="space-y-2">
                    <Label htmlFor={codeId} className="sr-only">{backup ? "Backup code" : "Code"}</Label>
                    <Input
                        id={codeId}
                        value={code}
                        onChange={(event) => setCode(backup ? event.target.value : formatTwoFactorCode(event.target.value))}
                        inputMode={backup ? "text" : "numeric"}
                        autoComplete="one-time-code"
                        placeholder={backup ? "XXXX-XXXX-XXXX" : "123456"}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${codeId}-error` : undefined}
                        className="h-12 text-center font-mono text-lg tracking-widest"
                        autoFocus
                    />
                    {error && <p id={`${codeId}-error`} className="text-xs text-destructive">{error}</p>}
                </div>
                <Button type="submit" size="lg" className="w-full" disabled={busy || !complete}>
                    {busy && <Loader2 className="animate-spin" />}
                    Verify
                </Button>
            </form>
            <OrDivider />
            <PasskeyButton label="Use a passkey instead" onClick={onPasskey} busy={passkeyBusy} />
            <div className="mt-5 flex items-center justify-between gap-4">
                <button type="button" onClick={switchKind} className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                    <KeyRound className="size-3.5" aria-hidden="true" />
                    {backup ? "Use the app instead" : "Use a backup code"}
                </button>
                <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                    <ArrowLeft className="size-3.5" aria-hidden="true" />
                    Back to sign in
                </button>
            </div>
        </div>
    );
}
