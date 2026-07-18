"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { authClient } from "@/lib/auth/client"
import {
    getMySsoConnections,
    unlinkMySsoAccount,
    initiateSsoConnect,
    type SsoConnection,
    type ConnectableProvider,
} from "@/app/actions/auth/sso-connections"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Trash2, ShieldCheck, Box, Settings2, Globe, PlugZap } from "lucide-react"
import { toast } from "sonner"
import { DateDisplay } from "@/components/utils/date-display"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// Same mapping used in the admin SSO provider list and on the login page -
// keeps the OIDC adapter icon consistent everywhere it's rendered.
function getProviderIcon(adapterId: string | null) {
    switch (adapterId) {
        case "authentik": return ShieldCheck
        case "pocket-id": return Box
        case "generic": return Settings2
        default: return Globe
    }
}

interface SsoFormProps {
    canManageSso: boolean;
}

export function SsoForm({ canManageSso }: SsoFormProps) {
    const router = useRouter()
    const searchParams = useSearchParams()

    const [connections, setConnections] = useState<SsoConnection[]>([])
    const [connectableProviders, setConnectableProviders] = useState<ConnectableProvider[]>([])
    const [totalAccountCount, setTotalAccountCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [unlinkTarget, setUnlinkTarget] = useState<SsoConnection | null>(null)
    const [unlinking, setUnlinking] = useState(false)
    const [connectingProviderId, setConnectingProviderId] = useState<string | null>(null)

    const fetchConnections = useCallback(async () => {
        try {
            const result = await getMySsoConnections()
            setConnections(result.connections)
            setConnectableProviders(result.connectableProviders)
            setTotalAccountCount(result.totalAccountCount)
        } catch {
            toast.error("Failed to load SSO connections")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchConnections()
    }, [fetchConnections])

    // Show a one-time success toast after returning from the "connect" flow,
    // then strip the query param so a reload/back-navigation doesn't repeat it.
    useEffect(() => {
        if (searchParams.get("connected") === "1") {
            toast.success("SSO provider connected")
            const params = new URLSearchParams(searchParams.toString())
            params.delete("connected")
            const query = params.toString()
            router.replace(`/dashboard/profile${query ? `?${query}` : ""}`)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleUnlink = async () => {
        if (!unlinkTarget) return
        setUnlinking(true)
        try {
            const result = await unlinkMySsoAccount(unlinkTarget.providerId, unlinkTarget.accountId)
            if (result.success) {
                toast.success("Connection removed")
                setConnections((prev) => prev.filter((c) => c.id !== unlinkTarget.id))
                setTotalAccountCount((prev) => prev - 1)
                await fetchConnections()
            } else {
                toast.error(result.error || "Failed to remove connection")
            }
        } catch {
            toast.error("Failed to remove connection")
        } finally {
            setUnlinking(false)
            setUnlinkTarget(null)
        }
    }

    const handleConnect = async (providerId: string) => {
        setConnectingProviderId(providerId)
        try {
            const result = await initiateSsoConnect(providerId)
            if (!result.success) {
                toast.error(result.error)
                setConnectingProviderId(null)
                return
            }
            // Redirects the browser to the IdP - no need to reset loading state on success.
            await authClient.signIn.sso({
                providerId,
                callbackURL: result.callbackURL,
                requestSignUp: false,
            })
        } catch {
            toast.error("Failed to start connection")
            setConnectingProviderId(null)
        }
    }

    const isLastAccount = totalAccountCount <= 1

    return (
        <Card>
            <CardHeader>
                <CardTitle>Single Sign-On</CardTitle>
                <CardDescription>
                    Manage which identity providers are linked to your account. Removing a connection doesn&apos;t
                    disable SSO - it re-links automatically the next time you sign in with that provider.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <>
                        <div className="space-y-3">
                            {connections.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No SSO provider is currently linked to your account.
                                </p>
                            ) : (
                                connections.map((connection) => {
                                    const Icon = getProviderIcon(connection.adapterId)
                                    return (
                                        <div
                                            key={connection.id}
                                            className="flex items-center gap-4 rounded-lg border p-4"
                                        >
                                            <div className="shrink-0 p-2 rounded-md bg-muted text-primary">
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            <div className="flex-1 min-w-0 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-sm">{connection.providerName}</span>
                                                    {!connection.providerAvailable && (
                                                        <Badge variant="secondary" className="text-xs">
                                                            Provider no longer available
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    Connected on <DateDisplay date={connection.createdAt} format="Pp" />
                                                </p>
                                            </div>
                                            <div className="shrink-0">
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                disabled={isLastAccount || !canManageSso}
                                                                onClick={() => setUnlinkTarget(connection)}
                                                            >
                                                                <Trash2 className="h-4 w-4 text-destructive" />
                                                            </Button>
                                                        </span>
                                                    </TooltipTrigger>
                                                    {!canManageSso ? (
                                                        <TooltipContent>
                                                            You don&apos;t have permission to manage SSO connections.
                                                        </TooltipContent>
                                                    ) : isLastAccount ? (
                                                        <TooltipContent>
                                                            You need at least one other login method before removing this connection.
                                                        </TooltipContent>
                                                    ) : null}
                                                </Tooltip>
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>

                        {connectableProviders.length > 0 && (
                            <div className="space-y-3 border-t pt-4">
                                <h4 className="text-sm font-medium">Connect another provider</h4>
                                <div className="space-y-2">
                                    {connectableProviders.map((provider) => {
                                        const Icon = getProviderIcon(provider.adapterId)
                                        const isConnecting = connectingProviderId === provider.providerId
                                        return (
                                            <div
                                                key={provider.providerId}
                                                className="flex items-center gap-4 rounded-lg border border-dashed p-4"
                                            >
                                                <div className="shrink-0 p-2 rounded-md bg-muted text-primary">
                                                    <Icon className="h-5 w-5" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <span className="font-medium text-sm">{provider.name}</span>
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={isConnecting || !canManageSso}
                                                    onClick={() => handleConnect(provider.providerId)}
                                                >
                                                    {isConnecting ? (
                                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                    ) : (
                                                        <PlugZap className="h-4 w-4 mr-2" />
                                                    )}
                                                    Connect
                                                </Button>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {connections.length === 0 && connectableProviders.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                                No SSO provider is currently available to connect. Ask your administrator if you think
                                this is unexpected.
                            </p>
                        )}
                    </>
                )}
            </CardContent>

            <AlertDialog open={!!unlinkTarget} onOpenChange={(open) => !open && setUnlinkTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove this connection?</AlertDialogTitle>
                        <AlertDialogDescription>
                            You will be disconnected from {unlinkTarget?.providerName}. Signing in with this provider
                            again will automatically re-link it to your account.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleUnlink} disabled={unlinking}>
                            {unlinking && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    )
}
