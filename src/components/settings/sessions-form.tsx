"use client"

import { useState, useEffect, useCallback } from "react"
import { authClient } from "@/lib/auth/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Globe, Trash2, LogOut } from "lucide-react"
import { toast } from "sonner"
import { DateDisplay } from "@/components/utils/date-display"
import { BrowserIcon, OsIcon } from "@/components/auth/device-icons"
import { formatIpAddress, parseUserAgent } from "@/lib/core/user-agent"
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

interface SessionInfo {
    id: string
    token: string
    createdAt: Date
    updatedAt: Date
    expiresAt: Date
    ipAddress: string | null
    userAgent: string | null
}

export function SessionsForm() {
    const { data: currentSession } = authClient.useSession()
    const [sessions, setSessions] = useState<SessionInfo[]>([])
    const [loading, setLoading] = useState(true)
    const [revokingId, setRevokingId] = useState<string | null>(null)
    const [revokeAllOpen, setRevokeAllOpen] = useState(false)
    const [revokingAll, setRevokingAll] = useState(false)

    const fetchSessions = useCallback(async () => {
        try {
            const result = await authClient.listSessions()
            if (result.data) {
                setSessions(result.data as unknown as SessionInfo[])
            }
        } catch {
            toast.error("Failed to load sessions")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchSessions()
    }, [fetchSessions])

    const handleRevoke = async (token: string, sessionId: string) => {
        setRevokingId(sessionId)
        try {
            await authClient.revokeSession({ token })
            setSessions((prev) => prev.filter((s) => s.id !== sessionId))
            toast.success("Session revoked")
        } catch {
            toast.error("Failed to revoke session")
        } finally {
            setRevokingId(null)
        }
    }

    const handleRevokeOthers = async () => {
        setRevokingAll(true)
        try {
            await authClient.revokeOtherSessions()
            await fetchSessions()
            toast.success("All other sessions revoked")
        } catch {
            toast.error("Failed to revoke sessions")
        } finally {
            setRevokingAll(false)
            setRevokeAllOpen(false)
        }
    }

    const currentToken = currentSession?.session?.token
    const otherSessions = sessions.filter((s) => s.token !== currentToken)

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Active Sessions</CardTitle>
                        <CardDescription>
                            Manage your active sessions across devices. You can revoke any session to force a re-login.
                        </CardDescription>
                    </div>
                    {otherSessions.length > 0 && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRevokeAllOpen(true)}
                            disabled={revokingAll}
                        >
                            {revokingAll ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <LogOut className="h-4 w-4 mr-2" />
                            )}
                            Revoke All Others
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : sessions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                        No active sessions found.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {sessions.map((session) => {
                            const isCurrent = session.token === currentToken
                            const { browser, os, device } = parseUserAgent(session.userAgent)

                            return (
                                <div
                                    key={session.id}
                                    className="flex items-center gap-4 rounded-lg border p-4"
                                >
                                    <div className="shrink-0">
                                        <BrowserIcon browser={browser} device={device} />
                                    </div>
                                    <div className="flex-1 min-w-0 space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm flex items-center gap-1.5">
                                                {browser} on
                                                <span className="inline-flex items-center gap-1">
                                                    <OsIcon os={os} />
                                                    {os}
                                                </span>
                                            </span>
                                            {isCurrent && (
                                                <Badge variant="secondary" className="text-xs">
                                                    Current
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                            {session.ipAddress && (
                                                <span className="flex items-center gap-1">
                                                    <Globe className="h-3 w-3" />
                                                    {formatIpAddress(session.ipAddress)}
                                                </span>
                                            )}
                                            <span>
                                                Created: <DateDisplay date={session.createdAt} format="Pp" />
                                            </span>
                                            <span>
                                                Last seen: <DateDisplay date={session.updatedAt} format="Pp" />
                                            </span>
                                        </div>
                                    </div>
                                    <div className="shrink-0">
                                        {!isCurrent && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleRevoke(session.token, session.id)}
                                                disabled={revokingId === session.id}
                                            >
                                                {revokingId === session.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                )}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardContent>

            <AlertDialog open={revokeAllOpen} onOpenChange={setRevokeAllOpen}>
                <AlertDialogContent tone="destructive">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Revoke All Other Sessions?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will sign out all other devices. Your current session will not be affected.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleRevokeOthers} disabled={revokingAll}>
                            {revokingAll && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Revoke All
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    )
}
