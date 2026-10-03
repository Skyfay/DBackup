"use client";

import { Database, FileJson, KeyRound } from "lucide-react";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import type { RestorePreview } from "@/lib/types/config-backup";

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
    return (
        <div className="min-w-0 bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={note}>{note}</p>
        </div>
    );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
            <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0">{children}</dd>
        </div>
    );
}

/**
 * What a checked configuration backup holds, before its Restore: the file, its numbers and what
 * the restore does with them. The same in Settings, on the Backups page and on the sign-up page.
 */
export function RestoreContents({ preview, fileName }: { preview: RestorePreview; fileName: string }) {
    const { formatDate } = useDateFormatter();
    const database = preview.kind === "database";
    const made = [preview.createdAt ? formatDate(preview.createdAt, "Pp") : null, preview.version ? `by DBackup v${preview.version}` : null].filter(Boolean).join(" ");
    const count = (value: number) => value.toLocaleString("en-US");

    return (
        <div className="space-y-4">
            <div className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                    {database ? <Database className="size-4 text-muted-foreground" /> : <FileJson className="size-4 text-muted-foreground" />}
                </span>
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={fileName}>{fileName}</p>
                    <p className="text-xs text-muted-foreground">{database ? "A copy of the whole database of DBackup" : "A configuration file of an older version"}</p>
                </div>
            </div>

            <div>
                <p className="mb-2 text-sm font-medium">What it holds</p>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-5">
                    <Stat label="Connections" value={count(preview.counts.connections)} note="databases, destinations, channels" />
                    <Stat label="Jobs" value={count(preview.counts.jobs)} note="with their destinations" />
                    <Stat label="Templates" value={database ? count(preview.counts.templates) : "-"} note={database ? "of all five kinds" : "not in this file"} />
                    <Stat label="Users" value={count(preview.counts.users)} note="with their groups" />
                    <Stat label="History" value={count(preview.counts.runs)} note={preview.counts.runs > 0 ? "runs" : "left out"} />
                </div>
            </div>

            <dl className="divide-y text-sm">
                {made && <Fact label="Made">{made}{database && ". The restart brings an older copy up to date."}</Fact>}
                {database ? (
                    <>
                        <Fact label="Afterwards">Everyone signs in again, with an account of the backup.</Fact>
                        <Fact label="Kept">The database of now stays beside it as dbackup.db.before-restore.</Fact>
                    </>
                ) : (
                    <>
                        <Fact label="Not in it">Templates, the folders of file jobs and second factors. The restore says what that changes.</Fact>
                        <Fact label="Afterwards">What exists only here stays, nothing is deleted.</Fact>
                    </>
                )}
            </dl>

            {preview.otherKeys && (
                <p className="flex gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                    <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    It comes from a DBackup with another ENCRYPTION_KEY or BETTER_AUTH_SECRET. Its logins and second factors are encrypted again for this one.
                </p>
            )}
        </div>
    );
}
