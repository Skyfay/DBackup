"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Download, FileText, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { vacuumDatabaseAction } from "@/app/actions/settings/database";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn, formatBytes } from "@/lib/utils";
import type { DatabaseInfo } from "@/services/system/settings-types";
import { PartFrame, useSettingsFrame } from "./settings-frame";

const log = logger.child({ component: "database-part" });

function Stat({ label, value, note, warn = false }: { label: string; value: string; note: string; warn?: boolean }) {
    const [number, unit] = value.split(" ");
    return (
        <div className="min-w-0 bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn("mt-1 text-xl font-semibold tracking-tight tabular-nums", warn && "text-warning")}>
                {number}
                {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={note}>{note}</p>
        </div>
    );
}

function ActionRow({ icon: Icon, title, text, children, setting }: { icon: typeof Database; title: string; text: string; setting: string; children: React.ReactNode }) {
    return (
        <li data-setting={setting} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                    <Icon className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="text-xs text-muted-foreground">{text}</p>
                </div>
            </div>
            {children}
        </li>
    );
}

/** The size of the database, what Optimize gives back and the download for a SuperAdmin. */
export function DatabasePart({ info, isSuperAdmin }: { info: DatabaseInfo | null; isSuperAdmin: boolean }) {
    const router = useRouter();
    const { readOnly } = useSettingsFrame();
    const [confirm, setConfirm] = useState<"optimize" | "download" | null>(null);
    const [pending, setPending] = useState(false);

    const optimize = async () => {
        setPending(true);
        try {
            const result = await vacuumDatabaseAction();
            if (!result.success || !result.data) {
                toast.error(result.error || "Optimizing the database failed");
                return;
            }
            const freed = Math.max(0, result.data.beforeBytes - result.data.afterBytes);
            toast.success(`Database optimized, ${formatBytes(freed)} freed`);
            setConfirm(null);
            router.refresh();
        } catch (error: unknown) {
            log.warn("Optimizing the database failed", {}, wrapError(error));
            toast.error("Optimizing the database failed");
        } finally {
            setPending(false);
        }
    };

    const download = async () => {
        setPending(true);
        const toastId = toast.loading("Copying the database");
        try {
            const res = await fetch("/api/settings/database/download", { method: "POST" });
            const payload = await res.json().catch(() => ({ error: "Download failed" }));
            if (!res.ok || !payload?.data?.token) throw new Error(payload?.error || "Download failed");

            // The browser fetches the file itself, so it goes straight to disk instead of into the tab.
            const anchor = document.createElement("a");
            anchor.href = `/api/settings/database/download?token=${encodeURIComponent(payload.data.token)}`;
            anchor.download = payload.data.fileName;
            anchor.click();

            toast.success("The download started, your browser shows how far it is", { id: toastId });
            setConfirm(null);
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : String(error), { id: toastId });
        } finally {
            setPending(false);
        }
    };

    const reclaimable = info?.reclaimableBytes ?? 0;
    return (
        <PartFrame part="database">
            {info ? (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
                        <Stat label="Size" value={formatBytes(info.totalBytes, 1)} note={info.walBytes > 0 ? `incl. ${formatBytes(info.walBytes, 1)} write-ahead log` : "one file"} />
                        <Stat label="Reclaimable" value={reclaimable > 0 ? formatBytes(reclaimable, 1) : "0 MB"} note={reclaimable > 0 ? "Optimize frees it" : "nothing to free"} warn={reclaimable > 0} />
                        <Stat label="Free disk space" value={info.freeDiskBytes !== null ? formatBytes(info.freeDiskBytes, 0) : "Unknown"} note="where the database lies" />
                        <Stat label="Journal" value={info.journalMode.toUpperCase()} note={info.journalMode.toLowerCase() === "wal" ? "readers never wait for the writer" : "one writer at a time"} />
                    </div>
                    <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate text-foreground" title={info.path}>{info.path}</span>
                        SQLite
                    </p>
                </div>
            ) : (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    The file system does not tell the size of the database right now.
                </p>
            )}

            <ul className="divide-y rounded-xl border">
                <ActionRow
                    icon={WandSparkles}
                    setting="database.optimize"
                    title="Optimize"
                    text={`Rebuilds the file without its unused space${reclaimable > 0 ? ` and frees about ${formatBytes(reclaimable, 1)}` : ""}. DBackup pauses for a moment, and it waits while a backup or restore runs.`}
                >
                    <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setConfirm("optimize")} disabled={readOnly || !info}>
                        <WandSparkles />
                        Optimize
                    </Button>
                </ActionRow>
                <ActionRow
                    icon={Download}
                    setting="database.download"
                    title="Download the database"
                    text="Holds every password hash, session and stored login. Only a SuperAdmin downloads it, and the audit log keeps who did."
                >
                    {isSuperAdmin && (
                        <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setConfirm("download")}>
                            <Download />
                            Download
                        </Button>
                    )}
                </ActionRow>
            </ul>

            <ConfirmDialog
                open={confirm === "optimize"}
                onOpenChange={(open) => !open && setConfirm(null)}
                title="Optimize the database?"
                note="DBackup pauses for a moment"
                description={`It rebuilds the database file without its unused space${reclaimable > 0 ? ` and frees about ${formatBytes(reclaimable, 1)}` : ""}. Runs that are queued wait until it is done, and it is refused while a backup or restore runs.`}
                icon={WandSparkles}
                tone="warning"
                confirmLabel="Optimize"
                isPending={pending}
                onConfirm={() => void optimize()}
            />
            <ConfirmDialog
                open={confirm === "download"}
                onOpenChange={(open) => !open && setConfirm(null)}
                title="Download the database?"
                note="Treat the file like a password"
                description="It holds every user with their password hash, the open sessions, the hashes of the API keys and every stored login. The logins stay encrypted with the ENCRYPTION_KEY of this instance, the sessions do not. The audit log keeps the download."
                icon={Download}
                tone="warning"
                confirmLabel="Download"
                isPending={pending}
                onConfirm={() => void download()}
            />
        </PartFrame>
    );
}
