"use client";

import Link from "next/link";
import { ArrowUpRight, KeyRound, ShieldCheck } from "lucide-react";
import { saveSignInSettingsAction } from "@/app/actions/settings/settings";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SettingsModel } from "@/services/system/settings-types";
import { Field, PartFrame, SaveBar, useSettingsFrame, usePartSave, usePartValues } from "./settings-frame";
import { SESSION_CHOICES, changesOf, secondsText, withSaved } from "./settings-values";

export const SIGN_IN_FIELDS = {
    sessionDuration: { label: "Sessions last", show: secondsText },
    passkeyLogin: { label: "Sign in with a passkey" },
} as const;

/** "Authentik and Pocket ID", or "Authentik, Keycloak and 2 more". */
function providerNames(names: string[]): string {
    if (names.length <= 2) return names.join(" and ");
    return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** How long sessions last, the passkey button, the password switch of the container and the providers. */
export function SignInPart({ model }: { model: SettingsModel["signIn"] }) {
    const { readOnly } = useSettingsFrame();
    const form = usePartValues("sign-in", { sessionDuration: model.sessionDuration, passkeyLogin: model.passkeyLogin });
    const save = usePartSave("sign-in");
    const { values, set } = form;
    const enabled = model.providers.filter((provider) => provider.enabled);
    // Off would leave nobody a way to sign in, so the switch stays on.
    const lastWayIn = model.passkeyIsLastWayIn && form.base.passkeyLogin;
    const passkeyError = save.errorOf("passkeyLogin");

    return (
        <>
            <PartFrame part="sign-in">
                <fieldset disabled={readOnly} className="min-w-0 space-y-6">
                    <Field label="Sessions last" setting="signin.sessions" hint="How long someone stays signed in. A new length applies from their next sign-in." error={save.errorOf("sessionDuration")}>
                        {(id) => (
                            <Select value={String(values.sessionDuration)} onValueChange={(seconds) => set("sessionDuration", Number(seconds))} disabled={readOnly}>
                                <SelectTrigger id={id} className="w-full sm:w-56">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {withSaved(SESSION_CHOICES, values.sessionDuration).map((seconds) => (
                                        <SelectItem key={seconds} value={String(seconds)}>
                                            {secondsText(seconds)}
                                            {seconds === 604800 ? " (default)" : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </Field>

                    <div className="space-y-2" data-setting="signin.passkey">
                        <SwitchList>
                            <SwitchRow
                                title="Sign in with a passkey"
                                description="The passkey button on the login page. A passkey as second factor keeps working either way."
                                checked={values.passkeyLogin}
                                onCheckedChange={(checked) => set("passkeyLogin", checked)}
                                disabled={lastWayIn}
                            />
                        </SwitchList>
                        {passkeyError ? (
                            <p className="text-xs text-destructive">{passkeyError}</p>
                        ) : (
                            lastWayIn && (
                                <p className="text-xs text-muted-foreground">
                                    It stays on while DISABLE_EMAIL_LOGIN turns passwords off and no sign-in provider is on, since a passkey is the only way in then.
                                </p>
                            )
                        )}
                    </div>
                </fieldset>

                <div data-setting="signin.password" className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-3">
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Sign in with a password</p>
                        <p className="text-xs text-muted-foreground">
                            {model.emailLoginDisabledByEnv ? (
                                <>Off through <code className="font-mono text-[11px]">DISABLE_EMAIL_LOGIN</code> on the container. New users and new passwords from Users & Groups still work.</>
                            ) : (
                                <>On. <code className="font-mono text-[11px]">DISABLE_EMAIL_LOGIN</code> on the container turns it off, so nobody locks themselves out from here.</>
                            )}
                        </p>
                    </div>
                    <Badge variant="outline" className={model.emailLoginDisabledByEnv ? "text-muted-foreground" : "border-success/30 bg-success/10 text-success"}>
                        {model.emailLoginDisabledByEnv ? "Off" : "On"}
                    </Badge>
                </div>

                <div data-setting="signin.providers" className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
                    <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Sign-in providers</p>
                        <p className="text-xs text-muted-foreground">
                            {model.providers.length === 0
                                ? "None yet. Only a SuperAdmin adds one, under Users & Groups."
                                : `${providerNames(enabled.map((provider) => provider.name)) || "None on"}${enabled.length < model.providers.length ? `, ${model.providers.length - enabled.length} off` : ""}. They are set up under Users & Groups.`}
                        </p>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/dashboard/users?tab=sso">
                            <ArrowUpRight />
                            Open
                        </Link>
                    </Button>
                </div>
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, SIGN_IN_FIELDS)}
                saving={save.saving}
                onDiscard={() => {
                    form.discard();
                    save.clearProblem();
                }}
                onSave={() => save.run(() => saveSignInSettingsAction(values), form.commit)}
            />
        </>
    );
}
