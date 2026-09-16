"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Database, Download, Loader2, Minimize2 } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getDatabaseInfoAction, vacuumDatabaseAction } from "@/app/actions/settings/database"
import type { DatabaseInfo } from "@/services/system/database-service"
import { formatBytes } from "@/lib/utils"

interface DatabaseCardProps {
    initialInfo: DatabaseInfo | null
    canManage: boolean
    isSuperAdmin: boolean
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="min-w-0 space-y-1 rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="truncate text-lg font-semibold">{value}</p>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
    )
}

export function DatabaseCard({ initialInfo, canManage, isSuperAdmin }: DatabaseCardProps) {
    const [info, setInfo] = useState(initialInfo)
    const [vacuumOpen, setVacuumOpen] = useState(false)
    const [isVacuuming, setIsVacuuming] = useState(false)
    const [downloadOpen, setDownloadOpen] = useState(false)
    const [isPreparing, setIsPreparing] = useState(false)

    const refreshInfo = async () => {
        const result = await getDatabaseInfoAction()
        if (result.success && result.data) setInfo(result.data)
    }

    const handleVacuum = async () => {
        setIsVacuuming(true)
        try {
            const result = await vacuumDatabaseAction()
            if (!result.success || !result.data) {
                toast.error(result.error || "Optimizing the database failed")
                return
            }
            const freed = Math.max(0, result.data.beforeBytes - result.data.afterBytes)
            toast.success(`Database optimized. Freed ${formatBytes(freed)}.`)
            setVacuumOpen(false)
            await refreshInfo()
        } finally {
            setIsVacuuming(false)
        }
    }

    const handleDownload = async () => {
        setIsPreparing(true)
        const toastId = toast.loading("Preparing database copy...")
        try {
            const res = await fetch("/api/settings/database/download", { method: "POST" })
            const payload = await res.json().catch(() => ({ error: "Download failed" }))
            if (!res.ok || !payload?.data?.token) {
                throw new Error(payload?.error || "Download failed")
            }

            // The browser fetches the file itself, so it goes straight to disk instead of into the tab.
            const anchor = document.createElement("a")
            anchor.href = `/api/settings/database/download?token=${encodeURIComponent(payload.data.token)}`
            anchor.download = payload.data.fileName
            anchor.click()

            toast.success("Download started - see your browser downloads for progress", { id: toastId })
            setDownloadOpen(false)
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : String(e), { id: toastId })
        } finally {
            setIsPreparing(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Database</CardTitle>
                </div>
                <CardDescription>
                    The SQLite database holding DBackup&apos;s configuration, users and history.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {info ? (
                    <>
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <Stat
                                label="Size"
                                value={formatBytes(info.totalBytes)}
                                hint={info.walBytes > 0 ? `incl. ${formatBytes(info.walBytes)} WAL` : undefined}
                            />
                            <Stat
                                label="Reclaimable"
                                value={info.reclaimableBytes > 0 ? `~${formatBytes(info.reclaimableBytes)}` : "0 Bytes"}
                                hint="by optimizing"
                            />
                            <Stat
                                label="Free disk space"
                                value={info.freeDiskBytes !== null ? formatBytes(info.freeDiskBytes) : "Unknown"}
                            />
                            <Stat label="Journal mode" value={info.journalMode.toUpperCase()} />
                        </div>
                        <p className="break-all font-mono text-xs text-muted-foreground">{info.path}</p>
                    </>
                ) : (
                    <p className="text-sm text-muted-foreground">Database information is not available right now.</p>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="outline" onClick={() => setVacuumOpen(true)} disabled={!canManage || !info}>
                        <Minimize2 className="mr-2 h-4 w-4" />
                        Optimize Database
                    </Button>
                    {isSuperAdmin && (
                        <Button variant="outline" onClick={() => setDownloadOpen(true)}>
                            <Download className="mr-2 h-4 w-4" />
                            Download Database
                        </Button>
                    )}
                </div>
            </CardContent>

            <AlertDialog open={vacuumOpen} onOpenChange={(next) => !isVacuuming && setVacuumOpen(next)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Optimize database?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Runs VACUUM to rebuild the database file without unused space
                            {info && info.reclaimableBytes > 0 ? `, freeing about ${formatBytes(info.reclaimableBytes)}` : ""}.
                            DBackup may not respond for a moment while this runs, and queued jobs wait until it has
                            finished. It is refused while a backup or restore is running.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isVacuuming}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isVacuuming}
                            // Radix closes on click. The dialog stays up until the VACUUM returns.
                            onClick={(event) => {
                                event.preventDefault()
                                handleVacuum()
                            }}
                        >
                            {isVacuuming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Optimize
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={downloadOpen} onOpenChange={(next) => !isPreparing && setDownloadOpen(next)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Download database?</AlertDialogTitle>
                        <AlertDialogDescription>
                            The file contains every user with their password hash, active sessions, API key hashes
                            and all stored credentials. Credentials stay encrypted and can only be read with this
                            instance&apos;s ENCRYPTION_KEY, but sessions do not. Treat the file like a password and
                            delete it when you no longer need it. The download is recorded in the audit log.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPreparing}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isPreparing}
                            onClick={(event) => {
                                event.preventDefault()
                                handleDownload()
                            }}
                        >
                            {isPreparing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Download
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    )
}
