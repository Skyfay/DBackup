"use client";

import Link from "next/link";
import { ArrowUpRight, CircleCheck, Download, Eye, Pencil, Settings2, TriangleAlert } from "lucide-react";
import { DetailStats, FactList, Section } from "@/components/adapter/connection-details-sections";
import { JobTile } from "@/components/dashboard/storage/explorer/explorer-cells";
import { BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { VaultKey, VaultKeyJob } from "@/services/vault/vault-types";
import { ActorText } from "./credential-details";
import { DestinationShare, KeyIdText, KeyTile } from "./vault-cells";
import { count } from "./vault-format";

/** A row that opens a job, or the config backup in the settings. */
function UseRow({ href, tile, name, detail }: { href: string; tile: React.ReactNode; name: string; detail: string }) {
    return (
        <li className="relative flex items-center gap-3 px-3 py-2 hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50">
            {tile}
            <div className="min-w-0 flex-1">
                <Link href={href} className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 hover:underline hover:underline-offset-4">
                    {name}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">{detail}</span>
            </div>
            <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </li>
    );
}

/** "Every day at 03:00", or "Paused" for a job that does not run. */
export function jobWhen(job: VaultKeyJob): string {
    return job.enabled ? describeSchedule(job.schedule).text : "Paused";
}

/** The jobs, and the config backup, that encrypt their new backups with the key. */
export function KeyUsers({ keyRow }: { keyRow: Pick<VaultKey, "jobs" | "configBackup"> }) {
    if (keyRow.jobs.length === 0 && !keyRow.configBackup) {
        return <p className="text-sm text-muted-foreground">No job encrypts with this key. Its backups still need it to be opened.</p>;
    }
    return (
        <ul className="divide-y rounded-lg border">
            {keyRow.jobs.map((job) => (
                <UseRow
                    key={job.id}
                    href={`/dashboard/jobs?job=${encodeURIComponent(job.id)}`}
                    tile={<JobTile job={{ kind: "job", sourceType: job.sourceType, hasFolders: job.hasFolders }} size="sm" />}
                    name={job.name}
                    detail={jobWhen(job)}
                />
            ))}
            {keyRow.configBackup && (
                <UseRow
                    href="/dashboard/settings?part=config-backup"
                    tile={<span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true"><Settings2 className="size-3.5 text-muted-foreground" /></span>}
                    name="Configuration backup"
                    detail="The backup of the settings of DBackup"
                />
            )}
        </ul>
    );
}

interface KeyDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    keyRow: VaultKey | null;
    auditDays: number;
    onClose: () => void;
    onKit?: (key: VaultKey) => void;
    onReveal?: (key: VaultKey) => void;
    onEdit?: (key: VaultKey) => void;
    /** The rest of what the key can do, as the menu of its row shows it. */
    groups: BackupActionGroup[];
}

/** Everything about one key in a panel from the right: what encrypts with it, what it protects and its recovery kit. */
export function KeyDetails({ open, keyRow, auditDays, onClose, ...rest }: KeyDetailsProps) {
    return (
        <Sheet open={open && keyRow !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {keyRow && <Content keyRow={keyRow} auditDays={auditDays} {...rest} />}
            </SheetContent>
        </Sheet>
    );
}

function Content({ keyRow, auditDays, onKit, onReveal, onEdit, groups }: Omit<KeyDetailsProps, "open" | "keyRow" | "onClose"> & { keyRow: VaultKey }) {
    const kit = keyRow.kit;
    const users = keyRow.jobs.length + (keyRow.configBackup ? 1 : 0);
    return (
        <>
            <SheetHeader className="gap-4 border-b p-5 pr-12">
                <div className="flex min-w-0 items-start gap-3">
                    <KeyTile size="lg" />
                    <div className="min-w-0">
                        <SheetTitle className="truncate text-lg font-semibold">{keyRow.name}</SheetTitle>
                        <SheetDescription className="truncate text-sm text-muted-foreground">
                            Key ID {keyRow.keyId ?? "unreadable"}
                            {keyRow.description && ` · ${keyRow.description}`}
                        </SheetDescription>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {onKit && (
                        <Button variant="outline" size="sm" onClick={() => onKit(keyRow)}>
                            <Download />
                            Recovery kit
                        </Button>
                    )}
                    {onReveal && (
                        <Button variant="outline" size="sm" onClick={() => onReveal(keyRow)}>
                            <Eye />
                            Reveal key
                        </Button>
                    )}
                    {onEdit && (
                        <Button variant="outline" size="sm" onClick={() => onEdit(keyRow)}>
                            <Pencil />
                            Edit
                        </Button>
                    )}
                    <BackupRowMenu name={keyRow.name} groups={groups} variant="outline" align="start" />
                </div>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-5">
                    <DetailStats
                        stats={[
                            { label: "Encrypts", value: users, extra: keyRow.configBackup && keyRow.jobs.length === 0 ? "config backup" : users === 1 ? "job" : "jobs" },
                            { label: "Protects", value: keyRow.backups.toLocaleString(), extra: keyRow.backups === 1 ? "backup" : "backups" },
                            {
                                label: "Recovery kit",
                                value: kit ? <RelativeTime date={kit.at} /> : "Never",
                                extra: kit ? (kit.by ? `by ${kit.by}` : "downloaded") : "no kit holds it",
                                className: kit ? undefined : "text-warning",
                            },
                            { label: "Created", value: <RelativeTime date={keyRow.createdAt} />, extra: keyRow.created?.by ? `by ${keyRow.created.by}` : " " },
                        ]}
                    />

                    <Section title={users > 0 ? `Encrypts ${count(users, "job")}` : "Encrypts"} aside={users > 0 ? "their new backups" : undefined}>
                        <KeyUsers keyRow={keyRow} />
                    </Section>

                    <Section
                        title={keyRow.backups > 0 ? `Protects ${count(keyRow.backups, "backup")}` : "Protects"}
                        aside={keyRow.backups > 0 ? `at ${count(keyRow.destinations.length, "destination")}` : undefined}
                    >
                        {keyRow.backups > 0 ? (
                            <DestinationShare destinations={keyRow.destinations} total={keyRow.backups} />
                        ) : (
                            <p className="text-sm text-muted-foreground">No listed backup was made with this key.</p>
                        )}
                    </Section>

                    <Section title="Recovery kit">
                        <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
                            {kit ? (
                                <div className="min-w-0 flex-1 space-y-0.5">
                                    <p className="flex items-center gap-2 text-sm font-medium">
                                        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
                                        <span>In a kit since <RelativeTime date={kit.at} /></span>
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {[kit.by && `downloaded by ${kit.by}`, kit.keys && kit.keys > 1 && `with ${count(kit.keys - 1, "more key")}`].filter(Boolean).join(", ") || "Keep it away from your backups."}
                                    </p>
                                </div>
                            ) : (
                                <div className="min-w-0 flex-1 space-y-0.5">
                                    <p className="flex items-center gap-2 text-sm font-semibold text-warning">
                                        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                                        Never downloaded
                                    </p>
                                    <p className="text-xs text-muted-foreground">Without it nobody can open these backups after a reinstall.</p>
                                </div>
                            )}
                            {onKit && (
                                <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => onKit(keyRow)}>
                                    <Download />
                                    Download kit
                                </Button>
                            )}
                        </div>
                    </Section>

                    <Section title="Details" aside={`the audit log keeps ${auditDays} days`}>
                        <FactList
                            facts={[
                                { label: "Key ID", value: <KeyIdText keyId={keyRow.keyId} /> },
                                { label: "Created", value: <ActorText date={keyRow.createdAt} actor={keyRow.created} /> },
                                {
                                    label: "Revealed",
                                    value: keyRow.revealed
                                        ? <><RelativeTime date={keyRow.revealed.at} />{keyRow.revealed.by && ` by ${keyRow.revealed.by}`}</>
                                        : `not in the last ${auditDays} days`,
                                },
                                { label: "Algorithm", value: "AES-256-GCM" },
                            ]}
                        />
                    </Section>
                </div>
            </ScrollArea>
        </>
    );
}
