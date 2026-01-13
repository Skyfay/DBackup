"use client"

import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function SecurityForm() {
    const { data: session } = authClient.useSession()
    const [isPending, setIsPending] = useState(false)
    const [totpURI, setTotpURI] = useState<string | null>(null)
    const [verificationCode, setVerificationCode] = useState("")
    const [backupCodes, setBackupCodes] = useState<string[]>([])
    const [showBackupCodes, setShowBackupCodes] = useState(false)
    const [password, setPassword] = useState("")
    const [isDisabling, setIsDisabling] = useState(false)

    // Check if 2FA is enabled from session
    const isTwoFactorEnabled = session?.user?.twoFactorEnabled


    const handleEnable2FA = async () => {
        setIsPending(true)
        try {
            const result = await authClient.twoFactor.enable({
                password: password
            })

            if (result.error) {
                toast.error(result.error.message)
                return
            }

            if (result.data) {
                setTotpURI(result.data.totpURI)
                setBackupCodes(result.data.backupCodes || [])
            }
        } catch (error) {
            console.error(error)
            toast.error("An error occurred")
        } finally {
            setIsPending(false)
        }
    }

    const handleVerifyTOTP = async () => {
        setIsPending(true)
        try {
            const result = await authClient.twoFactor.verifyTotp({
                code: verificationCode
            })

            if (result.error) {
                toast.error(result.error.message)
                return
            }

            toast.success("Two-factor authentication enabled successfully")
            setTotpURI(null)
            setShowBackupCodes(true)
        } catch (error) {
           console.error(error)
           toast.error("Verification failed")
        } finally {
            setIsPending(false)
        }
    }

    const handleDisable2FA = async () => {
        setIsDisabling(true)
        try {
            // Usually requires password again?
            // checking docs: disable({ password, ... })
             const result = await authClient.twoFactor.disable({
                password: password
            })

            if (result.error) {
                toast.error(result.error.message)
                return
            }

            toast.success("Two-factor authentication disabled")
        } catch (error) {
            toast.error("Error disabling 2FA")
        } finally {
            setIsDisabling(false)
            setPassword("")
        }
    }

    if (!session) {
        return null
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Security</CardTitle>
                <CardDescription>
                    Manage your account security settings and two-factor authentication.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-center justify-between space-x-2">
                    <div className="space-y-0.5">
                        <Label className="text-base">Two-Factor Authentication (2FA)</Label>
                        <p className="text-sm text-muted-foreground">
                            Enhance your account security with a second verification step.
                        </p>
                    </div>
                    {isTwoFactorEnabled && !showBackupCodes ? (
                         <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="destructive" size="sm" disabled={isDisabling}>
                                    {isDisabling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Disable
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Disable 2FA</DialogTitle>
                                    <DialogDescription>
                                        Please enter your password to disable two-factor authentication.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-2 py-4">
                                    <Label htmlFor="password-disable">Password</Label>
                                    <Input
                                        id="password-disable"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                </div>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setPassword("")}>Cancel</Button>
                                    <Button variant="destructive" onClick={handleDisable2FA} disabled={!password || isDisabling}>
                                        Disable
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    ) : (
                        <Dialog>
                             <DialogTrigger asChild>
                                <Button variant="default" size="sm">
                                    Enable
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle>Set up 2FA</DialogTitle>
                                    <DialogDescription>
                                       Protect your account in two steps.
                                    </DialogDescription>
                                </DialogHeader>

                                {!totpURI && !showBackupCodes && (
                                    <div className="space-y-4 py-4">
                                        <p className="text-sm">Enter your password to start the setup.</p>
                                        <div className="space-y-2">
                                            <Label htmlFor="password-enable">Password</Label>
                                            <Input
                                                id="password-enable"
                                                type="password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                            />
                                        </div>
                                        <Button onClick={handleEnable2FA} disabled={!password || isPending} className="w-full">
                                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Continue
                                        </Button>
                                    </div>
                                )}

                                {totpURI && !showBackupCodes && (
                                    <div className="space-y-4 py-4">
                                        <div className="flex justify-center p-4 bg-white rounded-lg">
                                            <QRCodeSVG value={totpURI} size={150} />
                                        </div>
                                        <p className="text-sm text-muted-foreground text-center">
                                            Scan this QR code with your authenticator app (e.g. Google Authenticator, Authy).
                                        </p>
                                        <div className="space-y-2">
                                            <Label htmlFor="code">Verification Code</Label>
                                            <Input
                                                id="code"
                                                placeholder="123456"
                                                value={verificationCode}
                                                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                className="text-center text-lg tracking-widest"
                                            />
                                        </div>
                                         <Button onClick={handleVerifyTOTP} disabled={verificationCode.length !== 6 || isPending} className="w-full">
                                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Verify & Enable
                                        </Button>
                                    </div>
                                )}

                                {showBackupCodes && (
                                     <div className="space-y-4 py-4">
                                        <div className="flex items-center gap-2 text-green-600 mb-2">
                                            <CheckCircle2 className="h-5 w-5" />
                                            <span className="font-medium">2FA enabled successfully!</span>
                                        </div>
                                        <Alert>
                                            <AlertCircle className="h-4 w-4" />
                                            <AlertTitle>Backup Codes</AlertTitle>
                                            <AlertDescription>
                                                Save these codes securely. You can use them if you lose access to your device.
                                            </AlertDescription>
                                        </Alert>
                                        <div className="grid grid-cols-2 gap-2 mt-4 bg-muted p-4 rounded-md font-mono text-sm">
                                            {backupCodes.map((code, i) => (
                                                <div key={i} className="text-center select-all">{code}</div>
                                            ))}
                                        </div>
                                        <Button className="w-full" onClick={() => setShowBackupCodes(false)}>
                                            Done
                                        </Button>
                                     </div>
                                )}

                            </DialogContent>
                        </Dialog>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
