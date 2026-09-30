"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { togglePasskeyTwoFactor } from "@/app/actions/auth/user";
import { SwitchRow } from "@/components/adapter/setting-switches";
import { PartFrame } from "@/components/dashboard/settings/settings-frame";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { ProfileModel } from "@/services/user/profile-model";
import { PasskeysSection, usePasskeys } from "./passkeys-section";
import { BackupCodesDialog, PasswordDialog, TwoFactorOffDialog, TwoFactorOnDialog } from "./security-dialogs";
import { SignInProviders } from "./sign-in-providers";

const log = logger.child({ component: "security-part" });

interface BlockProps {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    text: string;
    /** A second factor that is on, in green. */
    on?: boolean;
    setting: string;
    children?: React.ReactNode;
}

/** One way in: its icon, what it is right now and its buttons. */
function Block({ icon: Icon, title, text, on = false, setting, children }: BlockProps) {
    return (
        <div data-setting={setting} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", on ? "bg-success/12 text-success" : "border bg-muted/50 text-muted-foreground")} aria-hidden="true">
                <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-xs text-muted-foreground">{text}</p>
            </div>
            {children && <div className="flex flex-wrap gap-2">{children}</div>}
        </div>
    );
}

/**
 * How the viewer signs in: the password, the authenticator app with its backup codes, whether a
 * passkey counts as the second factor, the passkeys and the providers linked to them. What the group
 * does not allow stays visible without its buttons.
 */
export function SecurityPart({ model }: { model: ProfileModel }) {
    const router = useRouter();
    const { data: session, refetch } = authClient.useSession();
    const { passkeys, load } = usePasskeys();
    const { can, hasPassword } = model;
    const twoFactor = session ? !!session.user.twoFactorEnabled : model.user.twoFactorEnabled;
    const passkeyFactor = session ? !!(session.user as { passkeyTwoFactor?: boolean | null }).passkeyTwoFactor : model.user.passkeyTwoFactor;
    const [dialog, setDialog] = useState<"password" | "on" | "off" | "codes" | null>(null);
    const [switching, setSwitching] = useState(false);

    const changed = () => {
        void refetch();
        router.refresh();
    };

    const switchPasskeyFactor = async (checked: boolean) => {
        setSwitching(true);
        try {
            const result = await togglePasskeyTwoFactor(model.user.id, checked);
            if (!result.success) {
                toast.error(result.error || "That did not work.");
                return;
            }
            toast.success(checked ? "A passkey counts as the second factor" : "A passkey no longer counts as the second factor");
            changed();
        } catch (error) {
            log.warn("Switching the passkey factor failed", {}, wrapError(error));
            toast.error("That did not work.");
        } finally {
            setSwitching(false);
        }
    };

    const factorHint = twoFactor
        ? "Turn off the authenticator app first, one second factor is enough."
        : passkeys && passkeys.length === 0
            ? "Add a passkey first."
            : "Sign in with the password and a passkey instead of a code from the app.";

    return (
        <PartFrame part="security">
            {hasPassword ? (
                <>
                    <div className="overflow-hidden rounded-lg border">
                        <Block icon={KeyRound} title="Password" text={can.updatePassword ? "Change it with the one you have now." : "Your group may not change your password."} setting="profile.password">
                            {can.updatePassword && <Button type="button" variant="outline" size="sm" onClick={() => setDialog("password")}>Change password</Button>}
                        </Block>
                    </div>
                    <div className="divide-y overflow-hidden rounded-lg border">
                        <Block
                            icon={Smartphone}
                            title="Authenticator app"
                            on={twoFactor}
                            text={twoFactor ? "On. After the password DBackup asks for a code from the app." : "Off. Only your password protects the account."}
                            setting="profile.authenticator"
                        >
                            {can.manage2FA && (twoFactor ? (
                                <>
                                    <Button type="button" variant="outline" size="sm" onClick={() => setDialog("codes")}>New backup codes</Button>
                                    <Button type="button" variant="ghost-destructive" size="sm" onClick={() => setDialog("off")}>Turn off</Button>
                                </>
                            ) : (
                                <Button type="button" variant="outline" size="sm" disabled={passkeyFactor} title={passkeyFactor ? "A passkey counts as the second factor already." : undefined} onClick={() => setDialog("on")}>
                                    Turn on
                                </Button>
                            ))}
                        </Block>
                        <div data-setting="profile.passkey-factor">
                            <SwitchRow
                                title="A passkey counts as the second factor"
                                description={factorHint}
                                checked={passkeyFactor}
                                onCheckedChange={(checked) => void switchPasskeyFactor(checked)}
                                disabled={!can.managePasskeys || switching || (!passkeyFactor && (twoFactor || !passkeys || passkeys.length === 0))}
                            />
                        </div>
                    </div>
                </>
            ) : (
                <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                    You sign in without a password, with a passkey or a provider, so no second factor applies.
                </p>
            )}

            <PasskeysSection userId={model.user.id} canManage={can.managePasskeys} passkeyFactor={passkeyFactor} passkeys={passkeys} reload={load} onFactorChanged={changed} />

            {model.showSignInProviders && <SignInProviders canManage={can.manageSso} />}

            <PasswordDialog open={dialog === "password"} onOpenChange={(open) => setDialog(open ? "password" : null)} />
            <TwoFactorOnDialog open={dialog === "on"} onOpenChange={(open) => setDialog(open ? "on" : null)} onDone={changed} />
            <TwoFactorOffDialog open={dialog === "off"} onOpenChange={(open) => setDialog(open ? "off" : null)} onDone={changed} />
            <BackupCodesDialog open={dialog === "codes"} onOpenChange={(open) => setDialog(open ? "codes" : null)} />
        </PartFrame>
    );
}
