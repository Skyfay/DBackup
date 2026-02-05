"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { signIn, signUp, authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Fingerprint, AlertCircle } from "lucide-react"
import { formatTwoFactorCode } from "@/lib/utils"
import { ShieldCheck, Box, Settings2, Globe } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { logLoginSuccess } from "@/app/actions/audit-log"

const formSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().optional(),
})

interface LoginFormProps {
    allowSignUp?: boolean;
    ssoProviders?: { id: string; name: string; type: string; providerId: string; adapterId: string; domain: string | null; allowProvisioning: boolean }[];
    errorCode?: string;
    disablePasskeyLogin?: boolean;
}

// Error messages for SSO errors
const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
    sso_signup_disabled: {
        title: "Account not found",
        description: "Automatic user provisioning is disabled for this SSO provider. Please contact your administrator."
    },
    sso_user_not_found: {
        title: "User not found",
        description: "No account exists with this email address."
    },
    sso_access_denied: {
        title: "Access denied",
        description: "You do not have permission to sign in."
    },
    sso_error: {
        title: "SSO Error",
        description: "An error occurred during sign-in. Please try again."
    }
};

export function LoginForm({ allowSignUp = true, ssoProviders = [], errorCode, disablePasskeyLogin = false }: LoginFormProps) {
  const router = useRouter()
  const [isLogin, setIsLogin] = useState(true)
  const [isEmailStep, setIsEmailStep] = useState(true) // New state for 2-step login
  const [loading, setLoading] = useState(false)
  const [twoFactorStep, setTwoFactorStep] = useState(false)
  const [totpCode, setTotpCode] = useState("")
  const [isBackupCode, setIsBackupCode] = useState(false)

  // Get error message for display
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.sso_error : null;

  const handleSsoLogin = async (providerId: string, allowProvisioning: boolean) => {
        setLoading(true);
        try {
            const res = await signIn.sso({
                providerId: providerId,
                callbackURL: "/dashboard",
                // Pass allowProvisioning to server - this enables signup for this specific provider
                // Server has disableImplicitSignUp: true, so without requestSignUp: true, new users are blocked
                requestSignUp: allowProvisioning,
            });
            if (res.error) {
                 toast.error(res.error.message || "SSO Login failed");
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "SSO Login failed";
            toast.error(message);
        } finally {
            setLoading(false);
        }
  };

  const getSsoIcon = (adapterId: string) => {
        switch (adapterId) {
            case "authentik": return ShieldCheck;
            case "pocket-id": return Box;
            case "generic": return Settings2;
            default: return Globe;
        }
    };

  const handlePasskeyLogin = async () => {
        setLoading(true)
        try {
            const result = await signIn.passkey({
                fetchOptions: {
                    onSuccess: async () => {
                        await logLoginSuccess().catch(e => console.error("Logging failed", e));
                        toast.success("Login successful")
                        router.push("/dashboard")
                    }
                }
            })
             if (result?.error) {
                toast.error(result.error.message || "Failed to sign in with passkey")
            }
        } catch {
            toast.error("Failed to sign in with passkey")
        } finally {
            setLoading(false)
        }
  }

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
      name: "",
    },
  })

  async function handleVerify2FA() {
      setLoading(true)
      try {
          if (isBackupCode) {
               await authClient.twoFactor.verifyBackupCode({
                  code: totpCode,
                  fetchOptions: {
                      onSuccess: async () => {
                           await logLoginSuccess().catch(e => console.error("Logging failed", e));
                           router.push("/dashboard")
                           toast.success("Login successful")
                      },
                      onError: (ctx) => {
                          toast.error(ctx.error.message)
                          setLoading(false)
                      }
                  }
              })
          } else {
              await authClient.twoFactor.verifyTotp({
                  code: totpCode,
                  fetchOptions: {
                      onSuccess: async () => {
                           await logLoginSuccess().catch(e => console.error("Logging failed", e));
                           router.push("/dashboard")
                           toast.success("Login successful")
                      },
                      onError: (ctx) => {
                          toast.error(ctx.error.message)
                          setLoading(false)
                      }
                  }
              })
          }
      } catch (error) {
          console.error(error)
          toast.error("An error occurred")
          setLoading(false)
      }
  }


  const handleEmailNext = async (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent form submission
    const valid = await form.trigger("email")
    if (!valid) return

    const email = form.getValues("email")
    const domain = email.split("@")[1]

    if (!domain) {
        setIsEmailStep(false);
        return;
    }

    const matchedProvider = ssoProviders.find(p => p.domain && p.domain.toLowerCase() === domain.toLowerCase())

    if (matchedProvider) {
      await handleSsoLogin(matchedProvider.providerId, matchedProvider.allowProvisioning)
    } else {
      setIsEmailStep(false)
    }
  }

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true)
    try {
      if (isLogin) {
        await signIn.email({
          email: values.email,
          password: values.password,
          callbackURL: "/dashboard",
          fetchOptions: {
            onSuccess: async (ctx) => {
               console.log("Login Success Context:", ctx);
               if (ctx.data?.twoFactorRedirect) {
                 setTwoFactorStep(true)
                 setLoading(false)
                 return
               }
               await logLoginSuccess().catch(e => console.error("Logging failed", e));
              router.push("/dashboard")
            },
            onError: (ctx) => {
              console.log("Login Error Context:", ctx);
              if (ctx.error.code === "TWO_FACTOR_REQUIRED" || ctx.error.message?.includes("2FA") || ctx.error.message?.includes("Two factor")) {
                 setTwoFactorStep(true)
                 setLoading(false)
                 return
              }
              toast.error(ctx.error.message)
              setLoading(false)
            }
          }
        })
      } else {
        await signUp.email({
          email: values.email,
          password: values.password,
          name: values.name || values.email.split('@')[0],
          callbackURL: "/dashboard",
          fetchOptions: {
            onSuccess: () => {
              toast.success("Account created successfully!")
              router.push("/dashboard")
            },
            onError: (ctx) => {
              toast.error(ctx.error.message)
              setLoading(false)
            }
          }
        })
      }
    } catch (error) {
       console.error(error);
       setLoading(false);
    }
  }

  if (twoFactorStep) {
      return (
          <Card className="w-87.5">
               <CardHeader>
                  <CardTitle>{isBackupCode ? "Backup Code" : "Two-Factor Authentication"}</CardTitle>
                  <CardDescription>
                      {isBackupCode
                        ? "Enter one of your emergency backup codes."
                        : "Enter the code from your authenticator app."}
                  </CardDescription>
               </CardHeader>
               <CardContent>
                   <div className="space-y-4">
                       <Button
                            variant="outline"
                            className="w-full"
                            onClick={handlePasskeyLogin}
                       >
                            <Fingerprint className="mr-2 h-4 w-4"/>
                            Verify with Passkey
                       </Button>
                       <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-background px-2 text-muted-foreground">
                                Or use TOTP
                                </span>
                            </div>
                        </div>
                       <div className="space-y-2">
                           <Label htmlFor="2fa-code">{isBackupCode ? "Backup Code" : "Verification Code"}</Label>
                           <Input
                              id="2fa-code"
                              value={totpCode}
                              onChange={(e) => {
                                  if (isBackupCode) {
                                      setTotpCode(e.target.value)
                                  } else {
                                      setTotpCode(formatTwoFactorCode(e.target.value))
                                  }
                              }}
                              placeholder={isBackupCode ? "XXXX-XXXX-XXXX" : "123456"}
                              className={isBackupCode ? "text-center text-lg" : "text-center tracking-widest text-lg"}
                              autoFocus
                              onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                      handleVerify2FA()
                                  }
                              }}
                           />
                       </div>
                       <Button
                          onClick={handleVerify2FA}
                          className="w-full"
                          disabled={loading || (isBackupCode ? totpCode.length < 8 : totpCode.length !== 6)}
                       >
                          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Verify
                       </Button>
                       <div className="flex flex-col gap-2">
                            <Button
                                variant="link"
                                className="w-full h-auto p-0"
                                onClick={() => {
                                    setIsBackupCode(!isBackupCode)
                                    setTotpCode("")
                                }}
                            >
                                {isBackupCode ? "Use Authenticator App" : "Use Backup Code"}
                            </Button>
                           <Button
                              variant="ghost"
                              className="w-full"
                              onClick={() => {
                                  setTwoFactorStep(false)
                                  setTotpCode("")
                                  setIsBackupCode(false)
                              }}
                           >
                               Back to Login
                           </Button>
                       </div>
                   </div>
               </CardContent>
          </Card>
      )
  }

  return (
    <Card className="w-87.5">
      <CardHeader>
        <CardTitle>{isLogin ? "Login" : "Sign Up"}</CardTitle>
        <CardDescription>
          {isLogin
            ? "Enter your email to login to your account"
            : "Create a new account to get started"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* SSO Error Alert */}
        {errorMessage && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{errorMessage.title}</AlertTitle>
            <AlertDescription>{errorMessage.description}</AlertDescription>
          </Alert>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {!isLogin && (
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                        placeholder="m@example.com"
                        {...field}
                        disabled={isLogin && !isEmailStep}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && isLogin && isEmailStep) {
                                e.preventDefault();
                                handleEmailNext(e as any);
                            }
                        }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {(!isLogin || !isEmailStep) && (
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Password</FormLabel>
                    {isLogin && (
                         <Button
                            variant="link"
                            className="px-0 h-auto text-xs font-normal text-muted-foreground"
                            onClick={() => setIsEmailStep(true)}
                            type="button"
                         >
                            Change email
                         </Button>
                    )}
                  </div>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            )}
            {isLogin && isEmailStep ? (
                <Button
                    type="button"
                    className="w-full"
                    disabled={loading}
                    onClick={handleEmailNext}
                >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Next
                </Button>
            ) : (
                <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isLogin ? "Sign In" : "Sign Up"}
                </Button>
            )}
          </form>
        </Form>
        {isLogin && (
            <div className="mt-4 space-y-4">
                {ssoProviders.length > 0 && (
                    <div className="space-y-2">
                        {ssoProviders.map((provider) => {
                             const Icon = getSsoIcon(provider.adapterId);
                             return (
                                <Button
                                    key={provider.id}
                                    variant="outline"
                                    type="button"
                                    className="w-full relative" // relative for potential badge
                                    onClick={() => handleSsoLogin(provider.providerId, provider.allowProvisioning)}
                                    disabled={loading}
                                >
                                    <Icon className="mr-2 h-4 w-4 absolute left-4"/>
                                    Continue with {provider.name}
                                </Button>
                             );
                        })}
                    </div>
                )}

                {!disablePasskeyLogin && (
                    <>
                        {ssoProviders.length === 0 && (
                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-background px-2 text-muted-foreground">
                                    OR
                                    </span>
                                </div>
                            </div>
                        )}
                        <Button
                            variant="outline"
                            type="button"
                            className="w-full"
                            onClick={handlePasskeyLogin}
                            disabled={loading}
                        >
                            <Fingerprint className="mr-2 h-4 w-4"/>
                            Sign in with Passkey
                        </Button>
                    </>
                )}
            </div>
        )}
      </CardContent>
      {allowSignUp && (
      <CardFooter className="flex justify-center">
        <Button
            variant="link"
            onClick={() => {
                setIsLogin(!isLogin)
                setIsEmailStep(true)
            }}
            className="text-sm text-muted-foreground"
        >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Login"}
        </Button>
      </CardFooter>
      )}
    </Card>
  )
}
