"use client";

import { useWatch, type UseFormReturn } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { ProviderLogo } from "@/components/oidc/provider-logo";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { LoginProvider } from "@/services/auth/login-page-service";
import { ForgotHint, LoginHeading, LoginNote, OrDivider, PasskeyButton, PasswordInput, ProviderButton } from "./login-parts";
import { providerOfEmail, type LoginProblem } from "./login-problems";

export interface LoginValues {
    email: string;
    password: string;
}

interface SignInStepProps {
    form: UseFormReturn<LoginValues>;
    instance: string;
    providers: LoginProvider[];
    emailLogin: boolean;
    passkeyLogin: boolean;
    /** A provider claims a domain, so the email comes first and decides where it goes. */
    twoStep: boolean;
    /** The second screen of the two steps, the password of an email no provider claims. */
    passwordStep: boolean;
    problem: LoginProblem | null;
    loading: boolean;
    passkeyBusy: boolean;
    onProvider: (provider: LoginProvider) => void;
    onPasskey: () => void;
    onNext: () => void;
    onSubmit: () => void;
    onChangeEmail: () => void;
}

function EmailChip({ email, onChange }: { email: string; onChange: () => void }) {
    return (
        <div className="flex h-10 items-center gap-2.5 rounded-full border bg-muted/40 pr-3 pl-1">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold" aria-hidden="true">
                {email.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">{email}</span>
            <button type="button" onClick={onChange} className="rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                Change
            </button>
        </div>
    );
}

/** The first step of the login page: the providers, the email and its password, and the passkey. */
export function SignInStep(props: SignInStepProps) {
    const { form, instance, providers, emailLogin, passkeyLogin, twoStep, passwordStep, problem, loading, passkeyBusy } = props;
    const email = useWatch({ control: form.control, name: "email" });
    const claimed = twoStep && !passwordStep ? providerOfEmail(providers, email ?? "") : undefined;
    const domain = email?.split("@")[1];
    const showPassword = emailLogin && (!twoStep || passwordStep);
    const providerRows = !passwordStep && providers.length > 0;
    const noWayIn = !emailLogin && providers.length === 0 && !passkeyLogin;

    return (
        <div className="w-full max-w-sm">
            <LoginHeading title="Sign in" sub={`to ${instance}`} />
            {problem && <LoginNote title={problem.title}>{problem.text}</LoginNote>}
            {noWayIn && (
                <LoginNote title="No way to sign in">
                    Password sign-in is off and there is no provider or passkey. An admin sets <code className="font-mono text-[11px]">DISABLE_EMAIL_LOGIN=false</code> on the container and restarts DBackup.
                </LoginNote>
            )}

            {providerRows && (
                <div className="space-y-2.5">
                    {providers.map((provider) => (
                        <ProviderButton key={provider.id} provider={provider} onClick={() => props.onProvider(provider)} disabled={loading} />
                    ))}
                </div>
            )}
            {providerRows && emailLogin && <OrDivider />}

            {emailLogin && (
                <Form {...form}>
                    <form
                        noValidate
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (twoStep && !passwordStep) props.onNext();
                            else props.onSubmit();
                        }}
                        className="space-y-4"
                    >
                        {passwordStep ? (
                            <EmailChip email={email} onChange={props.onChangeEmail} />
                        ) : (
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Email</FormLabel>
                                        <FormControl>
                                            <Input type="email" autoComplete="username" placeholder="name@example.com" className="h-10" {...field} />
                                        </FormControl>
                                        {claimed && (
                                            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                <ProviderLogo adapterId={claimed.adapterId} className="size-3.5" />
                                                {domain} signs in with {claimed.name}
                                            </p>
                                        )}
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}
                        {showPassword && (
                            <FormField
                                control={form.control}
                                name="password"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Password</FormLabel>
                                        <FormControl>
                                            <PasswordInput autoComplete="current-password" autoFocus={passwordStep} {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}
                        <Button type="submit" size="lg" className="w-full" disabled={loading}>
                            {loading && <Loader2 className="animate-spin" />}
                            {showPassword ? "Sign in" : claimed ? `Continue with ${claimed.name}` : "Continue"}
                        </Button>
                    </form>
                </Form>
            )}

            {passkeyLogin && !passwordStep && (
                <>
                    {/* Right under the email when providers are listed above it, set apart from a form of its own. */}
                    {emailLogin ? providerRows ? <div className="h-2.5" /> : <OrDivider /> : providerRows && <OrDivider />}
                    <PasskeyButton onClick={props.onPasskey} disabled={loading} busy={passkeyBusy} />
                </>
            )}
            {showPassword && <ForgotHint />}
        </div>
    );
}
