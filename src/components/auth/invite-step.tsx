"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, DoorOpen, Link2Off, Loader2, LogIn, Users } from "lucide-react";
import { toast } from "sonner";
import { acceptInvitation } from "@/app/actions/tenant/invitation";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { announceTenantSwitch } from "@/components/tenant/tenant-sync";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/client";
import type { PasswordRules } from "@/lib/auth/password-policy";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { InvitationPreview } from "@/services/tenant/invitation-service";
import { InviteAccountForm } from "./invite-account-form";
import { inviteStep } from "./invite-model";
import { LoginHeading, LoginNote, OrDivider } from "./login-parts";

const log = logger.child({ component: "invite-step" });

interface InviteStepProps {
    token: string;
    invitation: InvitationPreview | null;
    signedIn: { name: string; email: string } | null;
    /** Sign-in with a password is on, so a new account can be made here. */
    passwordSignUp: boolean;
    /** The rules of a new password, only for someone who may make an account here. */
    rules: PasswordRules | null;
}

/** The tenant and the group a link leads to, with how long it still works. */
function InvitationCard({ invitation }: { invitation: InvitationPreview }) {
    return (
        <div className="flex items-center gap-3.5 rounded-xl border bg-card p-3.5 shadow-sm">
            <span className="flex size-10.5 shrink-0 items-center justify-center rounded-lg border bg-muted" aria-hidden="true">
                <Building2 className="size-5 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{invitation.tenantName}</p>
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">In the group {invitation.groupName}</span>
                </p>
            </div>
            <p className="shrink-0 text-right text-xs text-muted-foreground">
                Runs out
                <br />
                <RelativeTime date={invitation.expiresAt} />
            </p>
        </div>
    );
}

/** A link that is unknown, used or run out, which all read the same. */
function GoneStep({ signedIn }: { signedIn: boolean }) {
    return (
        <div className="w-full max-w-sm">
            <span className="mb-5 flex size-10.5 items-center justify-center rounded-lg border bg-muted" aria-hidden="true">
                <Link2Off className="size-5 text-muted-foreground" />
            </span>
            <LoginHeading title="This invitation does not work" sub="It was used already, ran out or was taken back. Ask whoever sent it for a new link." />
            <Button asChild size="lg" className="w-full">
                <Link href={signedIn ? "/dashboard" : "/"}>{signedIn ? "Go to the dashboard" : "Go to the sign-in"}</Link>
            </Button>
        </div>
    );
}

/** Someone signed in joins with the account they have. */
function JoinStep({ token, invitation, signedIn }: { token: string; invitation: InvitationPreview; signedIn: { name: string; email: string } }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    const join = async () => {
        setBusy(true);
        setProblem(null);
        try {
            const result = await acceptInvitation(token);
            if (!result.success) {
                setProblem(result.error);
                setBusy(false);
                return;
            }
            toast.success(result.data.joined ? `You work in ${result.data.tenantName} now` : `You work in ${result.data.tenantName} already`, {
                description: result.data.joined ? undefined : "You keep the group you have there.",
            });
            // The session works in the tenant now, in every tab, so the others load it too.
            announceTenantSwitch(result.data.tenantId, result.data.tenantName);
            router.push("/dashboard");
            router.refresh();
        } catch (error: unknown) {
            log.error("Accepting an invitation failed", {}, wrapError(error));
            setProblem("The invitation could not be accepted. Try again.");
            setBusy(false);
        }
    };

    const switchAccount = async () => {
        await signOut({ fetchOptions: { onSuccess: () => router.refresh() } });
    };

    return (
        <>
            <p className="mt-5 text-sm text-muted-foreground">
                You join as <span className="font-medium text-foreground">{signedIn.name || signedIn.email}</span>
                {signedIn.name && <> · {signedIn.email}</>}
            </p>
            {problem && <div className="mt-4"><LoginNote title="Joining did not work">{problem}</LoginNote></div>}
            <Button type="button" tone="create" size="lg" className="mt-4 w-full" onClick={() => void join()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <DoorOpen />}
                Join {invitation.tenantName}
            </Button>
            <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
                Not your account?{" "}
                <button type="button" onClick={() => void switchAccount()} className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                    Sign out
                </button>{" "}
                to join with another one.
            </p>
        </>
    );
}

/**
 * The page of an invitation link. It names the tenant and the group, lets someone signed in join
 * with a click, and offers everyone else the sign-in or, while passwords are on, a new account.
 * The login page has no way back to a link, so it says to open the link again after signing in.
 */
export function InviteStep({ token, invitation, signedIn, passwordSignUp, rules }: InviteStepProps) {
    const step = inviteStep({ invitation, signedIn });
    if (step === "gone" || !invitation) return <GoneStep signedIn={signedIn !== null} />;

    return (
        <div className="w-full max-w-sm">
            <LoginHeading title={`Join ${invitation.tenantName}`} sub="Someone invited you to work in this tenant." />
            <InvitationCard invitation={invitation} />

            {step === "join" && signedIn ? (
                <JoinStep token={token} invitation={invitation} signedIn={signedIn} />
            ) : (
                <>
                    <div className="mt-5 space-y-2.5">
                        <Button asChild variant={passwordSignUp ? "outline" : "default"} size="lg" className="w-full">
                            <Link href="/">
                                <LogIn />
                                Sign in
                            </Link>
                        </Button>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            Have an account here already? Sign in, then open this link again to join.
                            {!passwordSignUp && " New here? Sign in with the provider of your organization, then open this link again."}
                        </p>
                    </div>
                    {passwordSignUp && (
                        <>
                            <OrDivider label="or create an account" />
                            <InviteAccountForm token={token} tenantName={invitation.tenantName} rules={rules} />
                        </>
                    )}
                </>
            )}
        </div>
    );
}
