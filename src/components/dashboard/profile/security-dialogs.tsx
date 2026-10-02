"use client";

import { useId, useState } from "react";
import { Check, Copy, KeyRound, Loader2, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { updateOwnPassword } from "@/app/actions/auth/user";
import { PasswordChecklist } from "@/components/auth/password-checklist";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Tone } from "@/components/ui/tone";
import { authClient } from "@/lib/auth/client";
import { passwordProblem, type PasswordOwner, type PasswordRules } from "@/lib/auth/password-policy";
import { COPY_FAILED, copyToClipboard } from "@/lib/clipboard";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn, formatTwoFactorCode } from "@/lib/utils";

const log = logger.child({ component: "security-dialogs" });

interface StepDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tone: Tone;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    note: string;
    busy?: boolean;
    children: React.ReactNode;
    footer: React.ReactNode;
    onSubmit?: () => void;
}

/** A short dialog of the Security part: the tinted head, the fields, the buttons on their strip. */
export function StepDialog({ open, onOpenChange, tone, icon, title, note, busy = false, children, footer, onSubmit }: StepDialogProps) {
    return (
        <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
            <DialogContent tone={tone} showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-md")}>
                <form
                    className="flex min-h-0 flex-col"
                    onSubmit={(event) => {
                        event.preventDefault();
                        onSubmit?.();
                    }}
                >
                    <DialogHead tone={tone} icon={icon}>
                        <DialogTitle className="text-base">{title}</DialogTitle>
                        <DialogDescription className={dialogNoteClass(tone)}>{note}</DialogDescription>
                    </DialogHead>
                    <div className="grid min-w-0 gap-4 px-5 py-4">{children}</div>
                    <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>{footer}</div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

interface SecretFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    autoFocus?: boolean;
    /** "new-password" for a new one, so a password manager offers to make it. */
    autoComplete?: string;
}

function SecretField({ label, value, onChange, autoFocus = false, autoComplete = "current-password" }: SecretFieldProps) {
    const id = useId();
    return (
        <div className="grid gap-2">
            <Label htmlFor={id}>{label}</Label>
            <Input id={id} type="password" value={value} autoFocus={autoFocus} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} />
        </div>
    );
}

function Pending({ busy }: { busy: boolean }) {
    return busy ? <Loader2 className="animate-spin" /> : null;
}

/** The backup codes, each in mono, with Copy for all of them. */
function BackupCodes({ codes }: { codes: string[] }) {
    const [copied, setCopied] = useState(false);
    return (
        <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-1.5 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
                {codes.map((code) => <span key={code} className="text-center select-all">{code}</span>)}
            </div>
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => {
                    void copyToClipboard(codes.join("\n")).then((done) => {
                        if (!done) {
                            toast.error(COPY_FAILED);
                            return;
                        }
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 2000);
                    });
                }}
            >
                {copied ? <Check /> : <Copy />}
                Copy the codes
            </Button>
        </div>
    );
}

interface PasswordDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The rules of Settings > Passwords. */
    rules: PasswordRules;
    owner: PasswordOwner;
}

/**
 * Changes the password of the viewer with the current one. The rules tick off under the new one,
 * and Change password waits until every rule holds and both fields match.
 */
export function PasswordDialog({ open, onOpenChange, rules, owner }: PasswordDialogProps) {
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [again, setAgain] = useState("");
    const [busy, setBusy] = useState(false);
    const mismatch = again.length > 0 && next !== again;
    const ready = current.length > 0 && passwordProblem(next, rules, owner) === null && next === again;

    const close = (value: boolean) => {
        if (!value) {
            setCurrent("");
            setNext("");
            setAgain("");
        }
        onOpenChange(value);
    };

    const submit = async () => {
        if (!ready) return;
        setBusy(true);
        try {
            const result = await updateOwnPassword(current, next);
            if (!result.success) {
                toast.error(result.error || "The password could not be changed.");
                return;
            }
            const ended = result.data?.signedOut ?? 0;
            toast.success(ended > 0 ? `Password changed, ${ended} other ${ended === 1 ? "session" : "sessions"} ended` : "Password changed");
            close(false);
        } catch (error) {
            log.warn("Changing the own password failed", {}, wrapError(error));
            toast.error("The password could not be changed.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <StepDialog
            open={open}
            onOpenChange={close}
            tone="edit"
            icon={KeyRound}
            title="Change your password"
            note="With the one you have now"
            busy={busy}
            onSubmit={() => void submit()}
            footer={
                <>
                    <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy}>Cancel</Button>
                    <Button type="submit" disabled={busy || !ready}>
                        <Pending busy={busy} />
                        Change password
                    </Button>
                </>
            }
        >
            <SecretField label="Current password" value={current} onChange={setCurrent} autoFocus />
            <div className="grid gap-2">
                <SecretField label="New password" value={next} onChange={setNext} autoComplete="new-password" />
                <PasswordChecklist rules={rules} password={next} owner={owner} />
            </div>
            <div className="grid gap-2">
                <SecretField label="New password again" value={again} onChange={setAgain} autoComplete="new-password" />
                {mismatch && <p className="text-xs text-destructive">The two do not match.</p>}
            </div>
            <p className="text-xs text-muted-foreground">An admin sets these rules under Settings › Passwords. A new password signs you out of every other browser.</p>
        </StepDialog>
    );
}

type OnStep = "password" | "scan" | "codes";

/** Turns the authenticator app on: the password, the code to scan, then the backup codes. */
export function TwoFactorOnDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
    const [step, setStep] = useState<OnStep>("password");
    const [password, setPassword] = useState("");
    const [uri, setUri] = useState<string | null>(null);
    const [codes, setCodes] = useState<string[]>([]);
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const codeId = useId();
    const key = uri ? new URL(uri).searchParams.get("secret") ?? "" : "";

    const close = (value: boolean) => {
        if (!value) {
            setStep("password");
            setPassword("");
            setUri(null);
            setCode("");
            if (step === "codes") onDone();
        }
        onOpenChange(value);
    };

    const start = async () => {
        setBusy(true);
        try {
            const result = await authClient.twoFactor.enable({ password });
            if (result.error) {
                toast.error(result.error.message || "The authenticator app could not be set up.");
                return;
            }
            setUri(result.data?.totpURI ?? null);
            setCodes(result.data?.backupCodes ?? []);
            setStep("scan");
        } catch (error) {
            log.warn("Starting the authenticator app failed", {}, wrapError(error));
            toast.error("The authenticator app could not be set up.");
        } finally {
            setBusy(false);
        }
    };

    const verify = async () => {
        setBusy(true);
        try {
            const result = await authClient.twoFactor.verifyTotp({ code });
            if (result.error) {
                toast.error(result.error.message || "That code does not fit.");
                return;
            }
            toast.success("The authenticator app is on");
            setStep("codes");
        } catch (error) {
            log.warn("Checking the first code failed", {}, wrapError(error));
            toast.error("That code does not fit.");
        } finally {
            setBusy(false);
        }
    };

    const notes: Record<OnStep, string> = { password: "Step 1 of 3", scan: "Step 2 of 3", codes: "Step 3 of 3" };
    const footer = {
        password: (
            <>
                <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy}>Cancel</Button>
                <Button type="submit" disabled={busy || !password}>
                    <Pending busy={busy} />
                    Continue
                </Button>
            </>
        ),
        scan: (
            <>
                <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy}>Cancel</Button>
                <Button type="submit" disabled={busy || code.length !== 6}>
                    <Pending busy={busy} />
                    Turn on
                </Button>
            </>
        ),
        codes: <Button type="button" onClick={() => close(false)}>Done</Button>,
    }[step];

    return (
        <StepDialog
            open={open}
            onOpenChange={close}
            tone="create"
            icon={Smartphone}
            title="Turn on the authenticator app"
            note={notes[step]}
            busy={busy}
            onSubmit={() => void (step === "password" ? start() : step === "scan" ? verify() : undefined)}
            footer={footer}
        >
            {step === "password" && (
                <>
                    <p className="text-sm text-muted-foreground">After your password, DBackup then asks for a code from an app like 1Password, Google Authenticator or Authy.</p>
                    <SecretField label="Your password" value={password} onChange={setPassword} autoFocus />
                </>
            )}
            {step === "scan" && uri && (
                <>
                    <div className="grid justify-items-center gap-2.5">
                        <div className="rounded-lg border bg-white p-2">
                            <QRCodeSVG value={uri} size={160} />
                        </div>
                        <p className="text-center text-sm text-muted-foreground">Scan the code with the app, or enter the key below by hand.</p>
                    </div>
                    {/* The whole key, in groups of four like the apps show it. The code above holds it anyway, so it is not hidden. */}
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3">
                        <code className="min-w-0 flex-1 font-mono text-sm tracking-wide break-words">{key.match(/.{1,4}/g)?.join(" ")}</code>
                        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => void copyToClipboard(key).then((copied) => (copied ? toast.success("Key copied") : toast.error(COPY_FAILED)))} aria-label="Copy the key">
                            <Copy />
                        </Button>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor={codeId}>The code the app shows</Label>
                        <Input id={codeId} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="text-center font-mono text-lg tracking-widest" value={code} onChange={(event) => setCode(formatTwoFactorCode(event.target.value))} autoFocus />
                    </div>
                </>
            )}
            {step === "codes" && (
                <>
                    <p className="text-sm text-muted-foreground">Keep these codes somewhere safe. Each signs you in once when the phone is gone.</p>
                    <BackupCodes codes={codes} />
                </>
            )}
        </StepDialog>
    );
}

/** Turns the authenticator app off with the password. */
export function TwoFactorOffDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);

    const close = (value: boolean) => {
        if (!value) setPassword("");
        onOpenChange(value);
    };

    const submit = async () => {
        setBusy(true);
        try {
            const result = await authClient.twoFactor.disable({ password });
            if (result.error) {
                toast.error(result.error.message || "The authenticator app could not be turned off.");
                return;
            }
            toast.success("The authenticator app is off");
            onDone();
            close(false);
        } catch (error) {
            log.warn("Turning the authenticator app off failed", {}, wrapError(error));
            toast.error("The authenticator app could not be turned off.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <ConfirmDialog
            open={open}
            onOpenChange={close}
            icon={ShieldOff}
            destructive
            title="Turn off the authenticator app?"
            note="Only your password protects the account then"
            confirmLabel="Turn off"
            isPending={busy}
            disabled={!password}
            onConfirm={() => void submit()}
        >
            <SecretField label="Your password" value={password} onChange={setPassword} autoFocus />
        </ConfirmDialog>
    );
}

/** New backup codes for the authenticator app, which replace the ones before. */
export function BackupCodesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [password, setPassword] = useState("");
    const [codes, setCodes] = useState<string[] | null>(null);
    const [busy, setBusy] = useState(false);

    const close = (value: boolean) => {
        if (!value) {
            setPassword("");
            setCodes(null);
        }
        onOpenChange(value);
    };

    const submit = async () => {
        setBusy(true);
        try {
            const result = await authClient.twoFactor.generateBackupCodes({ password });
            if (result.error) {
                toast.error(result.error.message || "No new codes could be made.");
                return;
            }
            setCodes(result.data?.backupCodes ?? []);
        } catch (error) {
            log.warn("Making new backup codes failed", {}, wrapError(error));
            toast.error("No new codes could be made.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <StepDialog
            open={open}
            onOpenChange={close}
            tone="warning"
            icon={ShieldCheck}
            title="New backup codes"
            note={codes ? "The codes before no longer work" : "They replace the codes you have"}
            busy={busy}
            onSubmit={() => void (codes ? close(false) : submit())}
            footer={codes ? (
                <Button type="submit">Done</Button>
            ) : (
                <>
                    <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy}>Cancel</Button>
                    <Button type="submit" disabled={busy || !password}>
                        <Pending busy={busy} />
                        Make new codes
                    </Button>
                </>
            )}
        >
            {codes ? (
                <>
                    <p className="text-sm text-muted-foreground">Keep these codes somewhere safe. Each signs you in once when the phone is gone.</p>
                    <BackupCodes codes={codes} />
                </>
            ) : (
                <SecretField label="Your password" value={password} onChange={setPassword} autoFocus />
            )}
        </StepDialog>
    );
}
