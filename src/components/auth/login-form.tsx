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
import { Loader2 } from "lucide-react"

const formSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().optional(),
})

interface LoginFormProps {
    allowSignUp?: boolean;
}

export function LoginForm({ allowSignUp = true }: LoginFormProps) {
  const router = useRouter()
  const [isLogin, setIsLogin] = useState(true)
  const [loading, setLoading] = useState(false)
  const [twoFactorStep, setTwoFactorStep] = useState(false)
  const [totpCode, setTotpCode] = useState("")

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
          await authClient.twoFactor.verifyOtp({
              code: totpCode,
              fetchOptions: {
                  onSuccess: () => {
                       router.push("/dashboard")
                       toast.success("Login successful")
                  },
                  onError: (ctx) => {
                      toast.error(ctx.error.message)
                      setLoading(false)
                  }
              }
          })
      } catch (error) {
          console.error(error)
          toast.error("An error occurred")
          setLoading(false)
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
            onSuccess: (ctx) => {
               console.log("Login Success Context:", ctx);
               if (ctx.data?.twoFactorRedirect) {
                 setTwoFactorStep(true)
                 setLoading(false)
                 return
               }
              router.push("/dashboard")
            },
            onError: (ctx) => {
              console.log("Login Error Context:", ctx);
              if (ctx.error.code === "TWO_FACTOR_REQUIRED" || ctx.error.message.includes("2FA") || ctx.error.message.includes("Two factor")) {
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
          <Card className="w-[350px]">
               <CardHeader>
                  <CardTitle>Two-Factor Authentication</CardTitle>
                  <CardDescription>Enter the code from your authenticator app.</CardDescription>
               </CardHeader>
               <CardContent>
                   <div className="space-y-4">
                       <div className="space-y-2">
                           <Label htmlFor="2fa-code">Verification Code</Label>
                           <Input
                              id="2fa-code"
                              value={totpCode}
                              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              placeholder="123456"
                              className="text-center tracking-widest text-lg"
                              maxLength={6}
                              autoFocus
                              onKeyDown={(e) => {
                                  if (e.key === "Enter" && totpCode.length === 6) {
                                      handleVerify2FA()
                                  }
                              }}
                           />
                       </div>
                       <Button
                          onClick={handleVerify2FA}
                          className="w-full"
                          disabled={loading || totpCode.length !== 6}
                       >
                          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Verify
                       </Button>
                       <Button
                          variant="ghost"
                          className="w-full"
                          onClick={() => {
                              setTwoFactorStep(false)
                              setTotpCode("")
                          }}
                       >
                           Back to Login
                       </Button>
                   </div>
               </CardContent>
          </Card>
      )
  }

  return (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>{isLogin ? "Login" : "Sign Up"}</CardTitle>
        <CardDescription>
          {isLogin
            ? "Enter your email to login to your account"
            : "Create a new account to get started"}
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                    <Input placeholder="m@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLogin ? "Sign In" : "Sign Up"}
            </Button>
          </form>
        </Form>
      </CardContent>
      {allowSignUp && (
      <CardFooter className="flex justify-center">
        <Button
            variant="link"
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm text-muted-foreground"
        >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Login"}
        </Button>
      </CardFooter>
      )}
    </Card>
  )
}
