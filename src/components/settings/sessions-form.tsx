"use client"

import { useState, useEffect, useCallback } from "react"
import { Icon, type IconifyIcon } from "@iconify/react"
import { authClient } from "@/lib/auth/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Globe, Trash2, LogOut } from "lucide-react"
import { toast } from "sonner"
import { DateDisplay } from "@/components/utils/date-display"
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

// Browser icons (bundled, offline-capable)
import chromeIcon from "@iconify-icons/logos/chrome"
import braveIcon from "@iconify-icons/logos/brave"
import firefoxIcon from "@iconify-icons/logos/firefox"
import safariIcon from "@iconify-icons/logos/safari"
import edgeIcon from "@iconify-icons/logos/microsoft-edge"
import operaIcon from "@iconify-icons/logos/opera"
import vivaldiIcon from "@iconify-icons/logos/vivaldi-icon"
import arcIcon from "@iconify-icons/simple-icons/arc"
import torIcon from "@iconify-icons/simple-icons/torbrowser"

// OS icons
import appleIcon from "@iconify-icons/logos/apple"
import windowsIcon from "@iconify-icons/logos/microsoft-windows-icon"
import linuxIcon from "@iconify-icons/logos/linux-tux"
import androidIcon from "@iconify-icons/logos/android-icon"

// Fallback icons (MDI)
import monitorIcon from "@iconify-icons/mdi/monitor"
import cellphoneIcon from "@iconify-icons/mdi/cellphone"
import tabletIcon from "@iconify-icons/mdi/tablet"
import webIcon from "@iconify-icons/mdi/web"

interface SessionInfo {
    id: string
    token: string
    createdAt: Date
    updatedAt: Date
    expiresAt: Date
    ipAddress: string | null
    userAgent: string | null
}

type BrowserName = "Chrome" | "Brave" | "Firefox" | "Safari" | "Edge" | "Opera" | "Vivaldi" | "Arc" | "Tor Browser" | "Internet Explorer" | "Unknown"
type OsName = "Windows" | "macOS" | "Linux" | "Android" | "iOS" | "Chrome OS" | "Unknown"

const BROWSER_ICONS: Record<string, { icon: IconifyIcon; color?: string }> = {
    "Chrome": { icon: chromeIcon },
    "Brave": { icon: braveIcon },
    "Firefox": { icon: firefoxIcon },
    "Safari": { icon: safariIcon },
    "Edge": { icon: edgeIcon },
    "Opera": { icon: operaIcon },
    "Vivaldi": { icon: vivaldiIcon },
    "Arc": { icon: arcIcon, color: "#0085FF" },
    "Tor Browser": { icon: torIcon, color: "#7D4698" },
}

const OS_ICONS: Record<string, { icon: IconifyIcon; color?: string; darkInvert?: boolean }> = {
    "macOS": { icon: appleIcon, darkInvert: true },
    "iOS": { icon: appleIcon, darkInvert: true },
    "Windows": { icon: windowsIcon },
    "Linux": { icon: linuxIcon },
    "Android": { icon: androidIcon },
}

const DEVICE_ICONS: Record<string, IconifyIcon> = {
    "desktop": monitorIcon,
    "mobile": cellphoneIcon,
    "tablet": tabletIcon,
}

function parseUserAgent(ua: string | null): { browser: BrowserName; os: OsName; device: "desktop" | "mobile" | "tablet" } {
    if (!ua) return { browser: "Unknown", os: "Unknown", device: "desktop" }

    // Detect OS
    let os: OsName = "Unknown"
    if (ua.includes("Windows")) os = "Windows"
    else if (ua.includes("Mac OS X") || ua.includes("Macintosh")) os = "macOS"
    else if (ua.includes("CrOS")) os = "Chrome OS"
    else if (ua.includes("Android")) os = "Android"
    else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS"
    else if (ua.includes("Linux")) os = "Linux"

    // Detect Browser - order matters: specific browsers before generic Chrome/Safari
    let browser: BrowserName = "Unknown"
    if (ua.includes("Firefox/")) browser = "Firefox"
    else if (ua.includes("Edg/")) browser = "Edge"
    else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera"
    else if (ua.includes("Vivaldi/")) browser = "Vivaldi"
    else if (ua.includes("Brave")) browser = "Brave"
    else if (ua.includes("Arc/")) browser = "Arc"
    else if (ua.includes("Tor Browser") || ua.includes("TorBrowser")) browser = "Tor Browser"
    else if (ua.includes("Chrome/") && ua.includes("Safari/")) browser = "Chrome"
    else if (ua.includes("Safari/") && !ua.includes("Chrome")) browser = "Safari"
    else if (ua.includes("Trident/") || ua.includes("MSIE")) browser = "Internet Explorer"

    // Detect Device Type
    let device: "desktop" | "mobile" | "tablet" = "desktop"
    if (ua.includes("iPad") || ua.includes("Tablet")) device = "tablet"
    else if (ua.includes("Mobile") || ua.includes("iPhone") || (ua.includes("Android") && !ua.includes("Tablet"))) device = "mobile"

    return { browser, os, device }
}

function formatIpAddress(ip: string | null): string {
    if (!ip) return ""
    // Detect all-zeros IPv6 (expanded form from Better Auth)
    if (/^0{1,4}(:0{1,4}){7}$/.test(ip) || ip === "::") return "localhost"
    // Detect IPv6 loopback ::1
    if (/^0{1,4}(:0{1,4}){6}:0{0,3}1$/.test(ip) || ip === "::1") return "localhost"
    // Compress standard IPv6 for display (remove leading zeros in groups, collapse longest :: run)
    if (ip.includes(":") && !ip.includes(".")) {
        const groups = ip.split(":").map(g => g.replace(/^0+/, "") || "0")
        return groups.join(":").replace(/(?:^|:)0(?::0)*(?::|$)/, "::")
    }
    return ip
}

function BrowserIcon({ browser, device }: { browser: BrowserName; device: "desktop" | "mobile" | "tablet" }) {
    const browserEntry = BROWSER_ICONS[browser]
    if (browserEntry) {
        return (
            <Icon
                icon={browserEntry.icon}
                className="h-5 w-5"
                {...(browserEntry.color ? { style: { color: browserEntry.color } } : {})}
            />
        )
    }
    // Fallback: device-type icon
    return <Icon icon={DEVICE_ICONS[device] ?? webIcon} className="h-5 w-5 text-muted-foreground" />
}

function OsIcon({ os }: { os: OsName }) {
    const osEntry = OS_ICONS[os]
    if (!osEntry) return null
    return (
        <Icon
            icon={osEntry.icon}
            className={`h-3.5 w-3.5${osEntry.darkInvert ? " dark:invert" : ""}`}
            {...(osEntry.color ? { style: { color: osEntry.color } } : {})}        />
    )
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
