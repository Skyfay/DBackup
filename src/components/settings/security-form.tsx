"use client"

import { useState, useEffect } from "react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Loader2, CheckCircle2, AlertCircle, Fingerprint, Plus, Trash2, Smartphone } from "lucide-react"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { format } from "date-fns"
import { togglePasskeyTwoFactor as togglePasskeyAction } from "@/app/actions/user"

export function SecurityForm() {
    const { data: session, refetch } = authClient.useSession()
    const [isPending, setIsPending] = useState(false)
    const [totpURI, setTotpURI] = useState<string | null>(null)
    const [verificationCode, setVerificationCode] = useState("")
    const [backupCodes, setBackupCodes] = useState<string[]>([])
    const [showBackupCodes, setShowBackupCodes] = useState(false)
    const [password, setPassword] = useState("")
    const [isDisabling, setIsDisabling] = useState(false)

    // Passkey State
    const [passkeys, setPasskeys] = useState<any[]>([])
    const [isLoadingPasskeys, setIsLoadingPasskeys] = useState(false)
    const [passkeyName, setPasskeyName] = useState("")
    const [isAddPasskeyOpen, setIsAddPasskeyOpen] = useState(false)

    // Controlled Dialog State
    const [isEnableDialogOpen, setIsEnableDialogOpen] = useState(false)
    const [isDisableDialogOpen, setIsDisableDialogOpen] = useState(false)

    // Check if 2FA is enabled from session
    const isTwoFactorEnabled = session?.user?.twoFactorEnabled
    const isPasskeyTwoFactor = !!session?.user?.passkeyTwoFactor

    const fetchPasskeys = async () => {
        setIsLoadingPasskeys(true)
        try {
            const result = await authClient.passkey.listUserPasskeys()
            if (result.data) {
                setPasskeys(result.data)
            }
        } catch (error) {
            console.error("Failed to fetch passkeys", error)
        } finally {
            setIsLoadingPasskeys(false)
        }
    }

    useEffect(() => {
        if (session?.user) {
            fetchPasskeys()
        }
    }, [session])

    const handleEnable2FA = async () => {
        if (isPasskeyTwoFactor) {
             toast.error("Please disable Passkey 2FA first.")
             return
        }

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
            await refetch()
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
             const result = await authClient.twoFactor.disable({
                password: password
            })

            if (result.error) {
                toast.error(result.error.message)
                return
            }

            toast.success("Two-factor authentication disabled")
            setIsDisableDialogOpen(false)
            await refetch()
        } catch (error) {
            toast.error("Error disabling 2FA")
        } finally {
            setIsDisabling(false)
            setPassword("")
        }
    }

    const handleAddPasskey = async () => {
        setIsPending(true)
        try {
            // @ts-ignore - name is optional but helpful
            const result = await authClient.passkey.addPasskey({
                name: passkeyName || "My Passkey"
            })

            if (result?.error) {
                toast.error(result.error.message || "Failed to add passkey")
            } else {
                toast.success("Passkey added successfully")
                setPasskeyName("")
                setIsAddPasskeyOpen(false)
                await fetchPasskeys()
            }
        } catch (error) {
            console.error(error)
            toast.error("Failed to add passkey")
        } finally {
            setIsPending(false)
        }
    }

    const handleDeletePasskey = async (id: string) => {
        try {
             const result = await authClient.passkey.deletePasskey({
                 id
             })
             if (result?.error) {
                  toast.error(result.error.message)
             } else {
                 toast.success("Passkey deleted")
                 await fetchPasskeys()
             }
        } catch (error) {
            toast.error("Failed to delete passkey")
        }
    }

    const togglePasskeyTwoFactor = async (checked: boolean) => {
        if (checked && isTwoFactorEnabled) {
            toast.error("Please disable TOTP 2FA first to use Passkey as 2FA.")
            return
        }

        try {
            // Update user preference via Server Action
            if (session?.user?.id) {
                const result = await togglePasskeyAction(session.user.id, checked)
                if (result.success) {
                    toast.success(checked ? "Passkey configured as 2FA" : "Passkey configured for login only")
                    // Force a session refresh
                    await refetch()
                    // Reload to ensure state is consistent
                    window.location.reload()
                } else {
                     toast.error(result.error || "Failed to update settings")
                }
            }
        } catch (error) {
            toast.error("Failed to update settings")
        }
    }

    if (!session) {
        return null
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Two-Factor Authentication (TOTP)</CardTitle>
                    <CardDescription>
                        Use an authenticator app like Google Authenticator or Authy.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                             <div className={`p-2 rounded-full ${isTwoFactorEnabled ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                <Smartphone className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="font-medium">{isTwoFactorEnabled ? "Enabled" : "Disabled"}</h3>
                                <p className="text-sm text-muted-foreground">
                                    {isTwoFactorEnabled
                                        ? "Your account is secured with TOTP."
                                        : "Protect your account with a second verification step."}
                                </p>
                            </div>
                        </div>
                         {isTwoFactorEnabled && !showBackupCodes ? (
                             <Dialog open={isDisableDialogOpen} onOpenChange={setIsDisableDialogOpen}>
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
                                        <Button variant="outline" onClick={() => setIsDisableDialogOpen(false)}>Cancel</Button>
                                        <Button variant="destructive" onClick={handleDisable2FA} disabled={!password || isDisabling}>
                                            Disable
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        ) : (
                            <Dialog open={isEnableDialogOpen} onOpenChange={(open) => {
                                    setIsEnableDialogOpen(open)
                                    if (!open) {
                                        setTotpURI(null)
                                        setVerificationCode("")
                                        setPassword("")
                                    }
                                }}>
                                 <DialogTrigger asChild>
                                    <Button variant="default" size="sm" disabled={isPasskeyTwoFactor}>
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
                                            <Button className="w-full" onClick={() => {
                                                 setShowBackupCodes(false)
                                                 setIsEnableDialogOpen(false)
                                            }}>
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

            <Card>
                <CardHeader>
                     <CardTitle>Passkeys</CardTitle>
                      <CardDescription>
                        Use fingerprint, face recognition, or a security key.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                           <div className="flex items-center gap-2">
                                <div className={`p-2 rounded-full ${passkeys.length > 0 ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                                    <Fingerprint className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="font-medium">Passkeys</h3>
                                    <p className="text-sm text-muted-foreground">
                                        {passkeys.length} passkey(s) registered
                                    </p>
                                </div>
                           </div>
                           <Dialog open={isAddPasskeyOpen} onOpenChange={setIsAddPasskeyOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="sm">
                                        <Plus className="h-4 w-4 mr-2" />
                                        Add Passkey
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Add Passkey</DialogTitle>
                                        <DialogDescription>
                                            Name your passkey to easily identify it later.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="passkey-name">Passkey Name</Label>
                                            <Input
                                                id="passkey-name"
                                                placeholder="e.g. MacBook Pro, iPhone"
                                                value={passkeyName}
                                                onChange={(e) => setPasskeyName(e.target.value)}
                                            />
                                        </div>
                                        <Button onClick={handleAddPasskey} disabled={!passkeyName || isPending} className="w-full">
                                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Continue with Verification
                                        </Button>
                                    </div>
                                </DialogContent>
                           </Dialog>
                        </div>

                         {passkeys.length > 0 && (
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Name</TableHead>
                                            <TableHead>Created</TableHead>
                                            <TableHead className="w-[100px]"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {passkeys.map((pk) => (
                                            <TableRow key={pk.id}>
                                                <TableCell className="font-medium">{pk.name || "Unnamed Passkey"}</TableCell>
                                                <TableCell>{pk.createdAt ? format(new Date(pk.createdAt), 'PPP') : '-'}</TableCell>
                                                <TableCell>
                                                    <Button variant="ghost" size="icon" onClick={() => handleDeletePasskey(pk.id)}>
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}

                        {passkeys.length > 0 && (
                            <div className="flex items-center justify-between border-t pt-4">
                                <div className="space-y-0.5">
                                    <Label className="text-base">Use Passkey as 2FA</Label>
                                    <p className="text-sm text-muted-foreground">
                                        Required after password login instead of TOTP.
                                    </p>
                                </div>
                                <Switch
                                    checked={isPasskeyTwoFactor}
                                    onCheckedChange={togglePasskeyTwoFactor}
                                    disabled={isTwoFactorEnabled && !isPasskeyTwoFactor} // Disable switch if TOTP is ON, user must disable TOTP first (or my handle function tells them)
                                />
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
