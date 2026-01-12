"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useState } from 'react';
import { authenticate } from './actions';
import { signIn } from "next-auth/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { generatePasskeyAuthenticationOptions, verifyPasskeyFor2FA } from "@/actions/passkeys";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function LoginForm() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [showTwoFactor, setShowTwoFactor] = useState(false);
  const [verifyingPasskey, setVerifyingPasskey] = useState(false);

  // Store credentials temporarily for the second step
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsPending(true);
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);

    if (showTwoFactor) {
        formData.append("email", email);
        formData.append("password", password);
    } else {
        // Save for later
        setEmail(formData.get("email") as string);
        setPassword(formData.get("password") as string);
    }

    const result = await authenticate(undefined, formData);

    if (result) {
        if (result === "2FA_REQUIRED") {
            setShowTwoFactor(true);
            setErrorMessage(null); // Clear previous errors
        } else {
            setErrorMessage(result);
        }
    }

    setIsPending(false);
  };

  const handlePasskeyLogin = async () => {
    try {
        await signIn('webauthn');
    } catch (error) {
        console.error(error);
        setErrorMessage("Passkey login failed");
    }
  }

  const handlePasskey2FA = async () => {
      setVerifyingPasskey(true);
      try {
          // 1. Get Options
          const options = await generatePasskeyAuthenticationOptions(email);
          // 2. Start Auth (Browser)
          const asseResp = await startAuthentication(options);
          // 3. Verify on Server & Get Token
          const { success, token } = await verifyPasskeyFor2FA(asseResp, email);

          if (success && token) {
              // 4. Submit to credentials provider with token
              const formData = new FormData();
              formData.append("email", email);
              formData.append("password", password);
              formData.append("twoFactorToken", token);

              const result = await authenticate(undefined, formData);
              if (result) {
                  setErrorMessage(result);
              }
          }
      } catch (error) {
          console.error(error);
          // Check for predictable errors
          if (error instanceof Error && error.message.includes('Verification failed')) {
               setErrorMessage("Passkey verification failed");
          } else {
               setErrorMessage("Passkey verification failed or cancelled");
          }
      } finally {
          setVerifyingPasskey(false);
      }
  }

  return (
    <Card className="mx-auto max-w-sm w-full">
      <CardHeader>
        <CardTitle className="text-2xl">Login</CardTitle>
        <CardDescription>
          Enter your email below to login to your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          {!showTwoFactor && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  name="email"
                  placeholder="m@example.com"
                  required
                  defaultValue={email}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input id="password" type="password" name="password" required defaultValue={password} />
              </div>
            </>
          )}

          {showTwoFactor && (
            <div className="grid gap-4">
               <div className="grid gap-2">
                  <Label htmlFor="code">Two-Factor Code (TOTP)</Label>
                  <Input
                    id="code"
                    type="text"
                    name="code"
                    placeholder="123456"
                    // optional because we might use passkey
                    autoFocus
                    maxLength={6}
                    pattern="\d{6}"
                  />
               </div>

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

                <Button type="button" variant="outline" onClick={handlePasskey2FA} disabled={verifyingPasskey}>
                    {verifyingPasskey && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Verify with Passkey
                </Button>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isPending || verifyingPasskey}>
            {isPending ? "Logging in..." : (showTwoFactor ? "Verify Code" : "Login")}
          </Button>

          {!showTwoFactor && (
            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                        Or continue with
                    </span>
                </div>
            </div>
          )}

           {!showTwoFactor && (
             <Button type="button" variant="outline" className="w-full" onClick={handlePasskeyLogin}>
                Login with Passkey
             </Button>
           )}

          <div
            className="flex h-8 items-end space-x-1"
            aria-live="polite"
            aria-atomic="true"
          >
            {errorMessage && (
              <p className="text-sm text-red-500">
                {errorMessage}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
