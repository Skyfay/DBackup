"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { signIn } from "@/lib/auth/client"
import { ProviderTile } from "@/components/oidc/provider-logo"
import { Button } from "@/components/ui/button"
import { wrapError } from "@/lib/logging/errors"
import { logger } from "@/lib/logging/logger"
import type { LoginProvider } from "@/services/auth/login-page-service"
import { needsSecondFactor, providerOfEmail, signInError, ssoProblem, type LoginProblem } from "./login-problems"
import { SecondFactorStep } from "./second-factor-step"
import { SignInStep, type LoginValues } from "./sign-in-step"

const log = logger.child({ component: "LoginForm" })

/**
 * Set by the sign-out handler so the auto-redirect skips exactly one page load.
 * Without it the still-valid session at the identity provider signs the user
 * straight back in and logging out becomes impossible.
 */
export const SKIP_SSO_AUTO_REDIRECT_KEY = "dbackup.skipSsoAutoRedirect"

const schema = z.object({
    email: z.string().trim().email("Enter an email address."),
    // Only that one is there, the length was checked when the password was set.
    password: z.string().min(1, "Enter your password."),
})

/** A passkey prompt the person closed is no failure worth a note. */
const CANCELLED = /not allowed|timed out|cancel/i

interface LoginFormProps {
    /** The name under General, or DBackup. */
    instance: string;
    providers: LoginProvider[];
    emailLogin: boolean;
    passkeyLogin: boolean;
    autoRedirectProviderId: string | null;
    /** What a provider answered, from `?error=`. */
    errorCode?: string;
}

/** While OIDC_AUTO_REDIRECT goes to a provider, with a way out in case it does not answer. */
function RedirectStep({ provider }: { provider: LoginProvider }) {
    return (
        <div className="w-full max-w-sm text-center">
            <div className="flex justify-center">
                <ProviderTile adapterId={provider.adapterId} size="lg" />
            </div>
            <p role="status" className="mt-5 flex items-center justify-center gap-2 text-lg font-semibold">
                <Loader2 className="size-4.5 animate-spin text-muted-foreground" aria-hidden="true" />
                Taking you to {provider.name}
            </p>
            {provider.host && <p className="mt-1 text-sm text-muted-foreground">{provider.host}</p>}
            <Button
                type="button"
                variant="outline"
                className="mt-6"
                onClick={() => {
                    // The reload ends a redirect still on its way, the flag keeps the next load here.
                    sessionStorage.setItem(SKIP_SSO_AUTO_REDIRECT_KEY, "1")
                    window.location.reload()
                }}
            >
                Sign in another way
            </Button>
        </div>
    )
}

/**
 * The sign-in of the login page: a provider, the email with its password, a passkey, and the
 * second factor after the password. With a provider that claims a domain the email comes first
 * and its button says where it leads, without one email and password are one step.
 */
export function LoginForm({ instance, providers, emailLogin, passkeyLogin, autoRedirectProviderId, errorCode }: LoginFormProps) {
    const router = useRouter()
    const [step, setStep] = useState<"sign-in" | "password" | "factor">("sign-in")
    const [loading, setLoading] = useState(false)
    const [passkeyBusy, setPasskeyBusy] = useState(false)
    const [problem, setProblem] = useState<LoginProblem | null>(errorCode ? ssoProblem(errorCode) : null)
    const autoProvider = autoRedirectProviderId ? providers.find((provider) => provider.providerId === autoRedirectProviderId) : undefined
    // Derived from props only, so server and client agree and the form never flashes before the
    // redirect. The effect clears it if it stays, or if the redirect fails.
    const [redirecting, setRedirecting] = useState(Boolean(autoProvider) && !errorCode)
    const fired = useRef(false)
    const twoStep = emailLogin && providers.some((provider) => provider.domain)
    const form = useForm<LoginValues>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } })

    /** Returns false when the provider could not be reached, so the caller can fall back to the form. */
    const sso = useCallback(async (provider: LoginProvider): Promise<boolean> => {
        setLoading(true)
        setProblem(null)
        const failed = (text?: string) => setProblem({ title: `${provider.name} did not answer`, text: text || "Try again, or sign in another way." })
        try {
            // sso-guard.ts checks the wish to create an account against the saved provider.
            const result = await signIn.sso({ providerId: provider.providerId, callbackURL: "/dashboard", requestSignUp: provider.allowProvisioning })
            if (result.error) {
                failed(result.error.message)
                return false
            }
            return true
        } catch (error: unknown) {
            log.warn("Single sign-on failed", { providerId: provider.providerId }, wrapError(error))
            failed()
            return false
        } finally {
            setLoading(false)
        }
    }, [])

    // OIDC_AUTO_REDIRECT goes straight to its provider. Never with an error on screen, which would
    // loop and swallow it, and never on the load right after a sign-out.
    useEffect(() => {
        if (!autoProvider || errorCode || fired.current) return
        // Guards against React strict mode invoking the effect twice in development.
        fired.current = true
        if (sessionStorage.getItem(SKIP_SSO_AUTO_REDIRECT_KEY)) {
            sessionStorage.removeItem(SKIP_SSO_AUTO_REDIRECT_KEY)
            setRedirecting(false)
            return
        }
        sso(autoProvider)
            .then((ok) => {
                if (!ok) setRedirecting(false)
            })
            .catch((error: unknown) => {
                log.error("Automatic SSO redirect failed", {}, wrapError(error))
                setRedirecting(false)
            })
    }, [autoProvider, errorCode, sso])

    const passkey = async () => {
        setPasskeyBusy(true)
        setProblem(null)
        const failed = (message?: string) => {
            if (!message || !CANCELLED.test(message)) setProblem({ title: "The passkey did not sign you in", text: message || "Try again, or use your password." })
        }
        try {
            const result = await signIn.passkey({ fetchOptions: { onSuccess: () => router.push("/dashboard") } })
            if (result?.error) failed(String(result.error.message ?? ""))
        } catch (error: unknown) {
            failed(error instanceof Error ? error.message : undefined)
        } finally {
            setPasskeyBusy(false)
        }
    }

    const next = async () => {
        if (!(await form.trigger("email"))) return
        const provider = providerOfEmail(providers, form.getValues("email"))
        if (provider) {
            await sso(provider)
            return
        }
        form.clearErrors("password")
        setStep("password")
    }

    const submit = form.handleSubmit(async ({ email, password }) => {
        setLoading(true)
        setProblem(null)
        try {
            await signIn.email({
                email,
                password,
                callbackURL: "/dashboard",
                fetchOptions: {
                    onSuccess: (context) => {
                        if (context.data?.twoFactorRedirect) {
                            setStep("factor")
                            setLoading(false)
                            return
                        }
                        router.push("/dashboard")
                    },
                    onError: (context) => {
                        setLoading(false)
                        if (needsSecondFactor(context.error)) {
                            setStep("factor")
                            return
                        }
                        form.setError("password", { message: signInError(context.error) }, { shouldFocus: true })
                    },
                },
            })
        } catch (error: unknown) {
            log.error("Login submit failed", {}, wrapError(error))
            setLoading(false)
            form.setError("password", { message: "The sign-in failed. Try again." })
        }
    })

    const backToStart = () => {
        setStep("sign-in")
        setProblem(null)
        form.setValue("password", "")
        form.clearErrors()
    }

    if (redirecting && autoProvider) return <RedirectStep provider={autoProvider} />

    if (step === "factor") {
        return <SecondFactorStep email={form.getValues("email")} onBack={backToStart} onPasskey={() => void passkey()} passkeyBusy={passkeyBusy} problem={problem} />
    }

    return (
        <SignInStep
            form={form}
            instance={instance}
            providers={providers}
            emailLogin={emailLogin}
            passkeyLogin={passkeyLogin}
            twoStep={twoStep}
            passwordStep={step === "password"}
            problem={problem}
            loading={loading}
            passkeyBusy={passkeyBusy}
            onProvider={(provider) => void sso(provider)}
            onPasskey={() => void passkey()}
            onNext={() => void next()}
            onSubmit={() => void submit()}
            onChangeEmail={backToStart}
        />
    )
}
