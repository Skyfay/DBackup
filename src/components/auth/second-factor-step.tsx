"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Fingerprint, KeyRound, Loader2, ShieldCheck } from "lucide-react";
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
    /** The second factors better-auth named after the password, null when it named none. */
    factors: string[] | null;
    onBack: () => void;
    onPasskey: () => void;
    passkeyBusy: boolean;
    /** A passkey that failed, from the form around. */
    problem?: LoginProblem | null;
}

function BackLink({ onBack }: { onBack: () => void }) {
    return (
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to sign in
        </button>
    );
}

/** A passkey as the only second factor: asked for right away, with a button for another try. */
function PasskeyFactor({ email, onBack, onPasskey, passkeyBusy, problem }: SecondFactorStepProps) {
    const asked = useRef(false);

    // Opens the prompt of the passkey once the step shows. A browser that wants a click for it
    // refuses quietly, and the button below asks again.
    useEffect(() => {
        if (asked.current) return;
        asked.current = true;
        onPasskey();
    }, [onPasskey]);

    return (
        <div className="w-full max-w-sm">
            <span className="mb-5 flex size-10 items-center justify-center rounded-lg border bg-muted" aria-hidden="true">
                <Fingerprint className="size-4.5" />
            </span>
            <LoginHeading title="Confirm it is you" sub={`Use your passkey to finish signing in as ${email}.`} />
            {problem && <LoginNote title={problem.title}>{problem.text}</LoginNote>}
            <PasskeyButton label="Use your passkey" onClick={onPasskey} busy={passkeyBusy} primary />
            <div className="mt-5 flex justify-end">
                <BackLink onBack={onBack} />
            </div>
        </div>
    );
}

/**
 * The second factor after the password. A passkey that counts as the second factor is asked for
 * right away, without a code. Otherwise the code of the authenticator app, a backup code, or a
 * passkey instead.
 */
export function SecondFactorStep(props: SecondFactorStepProps) {
    const passkeyOnly = props.factors !== null && !props.factors.includes("totp");
    return passkeyOnly ? <PasskeyFactor {...props} /> : <CodeFactor {...props} />;
}

/** The code of the authenticator app, a backup code, or a passkey instead. */
function CodeFactor({ email, onBack, onPasskey, passkeyBusy, problem }: SecondFactorStepProps) {
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
                <BackLink onBack={onBack} />
            </div>
        </div>
    );
}
