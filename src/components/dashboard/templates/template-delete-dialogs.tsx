"use client";

import { useState } from "react";
import { Trash } from "lucide-react";
import { toast } from "sonner";
import {
    deleteExcludePatternPreset,
    deleteNamingTemplate,
    deleteNotificationTemplate,
    deleteRetentionPolicy,
    deleteSchedulePreset,
} from "@/app/actions/templates";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolveExcludePatterns } from "@/lib/exclude-groups";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { ExcludeRow, NamingRow, NotificationRow, RetentionRow, ScheduleRow, TemplateJob } from "@/services/templates/templates-types";
import { ConnectionRowTile, JobRowTile, KIND_ICONS, UseList, type TemplateKind, type UseEntry } from "./template-cells";
import { count, destinationHref, jobHref, lowerFirst } from "./template-format";

const log = logger.child({ component: "template-delete-dialogs" });

type DeleteResult = { success: boolean; error?: string };

interface DeleteProps<T> {
    row: T;
    jobs: Map<string, TemplateJob>;
    onClose: () => void;
    onDeleted: () => void;
}

/** The records that hold a template, each a link, scrolling once the list gets long. */
function Holders({ entries }: { entries: UseEntry[] }) {
    return (
        <ScrollArea className="min-w-0 *:data-[slot=scroll-area-viewport]:max-h-60 [&>[data-slot=scroll-area-viewport]>div]:block!">
            <UseList entries={entries} />
        </ScrollArea>
    );
}

function jobEntries(jobIds: string[], jobs: Map<string, TemplateJob>, detail: (job: TemplateJob | undefined) => string): UseEntry[] {
    return jobIds.map((jobId) => {
        const job = jobs.get(jobId);
        return { key: jobId, href: jobHref(jobId), tile: <JobRowTile job={job} />, name: job?.name ?? "A job", detail: detail(job) };
    });
}

const whenOf = (job: TemplateJob | undefined) => (!job ? "" : job.enabled ? describeSchedule(job.schedule).text : "Paused");

interface DeleteFrameProps {
    kind: TemplateKind;
    name: string;
    run: () => Promise<DeleteResult>;
    onClose: () => void;
    onDeleted: () => void;
    /** Why it cannot go yet, which keeps Delete off. The server refuses it the same way. */
    blocked?: { note: string; description: string };
    note?: string;
    description?: React.ReactNode;
    confirmLabel: string;
    children?: React.ReactNode;
}

/** A delete that names what depends on the template, and keeps its button off while something must change first. */
function DeleteFrame({ kind, name, run, onClose, onDeleted, blocked, note, description, confirmLabel, children }: DeleteFrameProps) {
    const [pending, setPending] = useState(false);

    const remove = async () => {
        setPending(true);
        try {
            const result = await run();
            if (result.success) {
                toast.success(`${name} deleted`);
                onDeleted();
                return;
            }
            toast.error(result.error || "It could not be deleted.");
        } catch (error: unknown) {
            // Without the right to write templates the action throws instead of answering.
            log.warn("A template could not be deleted", { kind }, wrapError(error));
            toast.error("It could not be deleted.");
        } finally {
            setPending(false);
        }
        onClose();
    };

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            icon={Trash}
            destructive
            title={`Delete ${name}?`}
            note={blocked?.note ?? note ?? "Cannot be undone"}
            description={blocked?.description ?? description}
            confirmLabel={confirmLabel}
            isPending={pending}
            disabled={blocked !== undefined}
            onConfirm={remove}
        >
            {children || (!blocked && <DialogItemList items={[{ name, icon: KIND_ICONS[kind] }]} />)}
        </ConfirmDialog>
    );
}

export function RetentionDeleteDialog({ row, jobs, onClose, onDeleted }: DeleteProps<RetentionRow>) {
    const picked = row.uses.filter((use) => use.how === "picked");
    const holders = picked.length + row.prefills.length;
    const blocked = row.isSystem
        ? { note: "Built in", description: "It ships with DBackup. It can be edited, but not deleted." }
        : row.isDefault
          ? { note: "The default policy", description: "Every destination without a policy of its own follows it. Make another policy the default first, or they would keep every backup." }
          : holders > 0
            ? { note: `${count(holders, "destination")} still ${holders === 1 ? "uses" : "use"} it`, description: "Pick another policy there first, then it can go." }
            : undefined;
    return (
        <DeleteFrame kind="retention" name={row.name} run={() => deleteRetentionPolicy(row.id)} onClose={onClose} onDeleted={onDeleted} blocked={blocked} confirmLabel="Delete policy">
            {!row.isSystem && !row.isDefault && holders > 0 && (
                <Holders
                    entries={[
                        ...picked.map((use) => ({
                            key: `${use.jobId}-${use.destinationId}`,
                            href: jobHref(use.jobId),
                            tile: <ConnectionRowTile adapterId={use.adapterId} />,
                            name: `${use.destinationName} of ${jobs.get(use.jobId)?.name ?? "a job"}`,
                            detail: "Picked in the job",
                        })),
                        ...row.prefills.map((connection) => ({
                            key: connection.id,
                            href: destinationHref(connection.id),
                            tile: <ConnectionRowTile adapterId={connection.adapterId} />,
                            name: connection.name,
                            detail: "Starts the destinations of new jobs with it",
                        })),
                    ]}
                />
            )}
        </DeleteFrame>
    );
}

export function NamingDeleteDialog({ row, jobs, onClose, onDeleted }: DeleteProps<NamingRow>) {
    const picked = row.uses.filter((use) => use.how === "picked").map((use) => use.jobId);
    const blocked = row.isSystem
        ? { note: "Built in", description: "It ships with DBackup and cannot be deleted." }
        : row.isDefault
          ? { note: "The default template", description: "Every job without a template of its own is named by it. Make another template the default first." }
          : picked.length > 0
            ? { note: `${count(picked.length, "job")} still ${picked.length === 1 ? "uses" : "use"} it`, description: `${picked.length === 1 ? "A job names its" : `${picked.length} jobs name their`} files with it. Pick another template there first, then it can go.` }
            : undefined;
    return (
        <DeleteFrame kind="naming" name={row.name} run={() => deleteNamingTemplate(row.id)} onClose={onClose} onDeleted={onDeleted} blocked={blocked} confirmLabel="Delete template">
            {!row.isSystem && !row.isDefault && picked.length > 0 && <Holders entries={jobEntries(picked, jobs, whenOf)} />}
        </DeleteFrame>
    );
}

export function ScheduleDeleteDialog({ row, jobs, onClose, onDeleted }: DeleteProps<ScheduleRow>) {
    const words = describeSchedule(row.schedule).text;
    const followers = row.jobIds.length;
    return (
        <DeleteFrame
            kind="schedule"
            name={row.name}
            run={() => deleteSchedulePreset(row.id)}
            onClose={onClose}
            onDeleted={onDeleted}
            note={followers > 0 ? `${count(followers, "job")} ${followers === 1 ? "follows" : "follow"} it` : undefined}
            description={followers > 0 ? `They keep running ${lowerFirst(words)} on their own. A later change of a preset no longer reaches them.` : undefined}
            confirmLabel="Delete preset"
        >
            {followers > 0 && <Holders entries={jobEntries(row.jobIds, jobs, () => `keeps running ${lowerFirst(words)}`)} />}
        </DeleteFrame>
    );
}

export function NotificationDeleteDialog({ row, jobs, onClose, onDeleted }: DeleteProps<NotificationRow>) {
    const users = row.jobIds.length;
    const blocked = row.isSystem
        ? { note: "Built in", description: "It ships with DBackup and cannot be deleted." }
        : users > 0
          ? { note: `${count(users, "job")} still ${users === 1 ? "uses" : "use"} it`, description: "Take it out of these jobs first, then it can go." }
          : undefined;
    return (
        <DeleteFrame kind="notification" name={row.name} run={() => deleteNotificationTemplate(row.id)} onClose={onClose} onDeleted={onDeleted} blocked={blocked} confirmLabel="Delete template">
            {!row.isSystem && users > 0 && <Holders entries={jobEntries(row.jobIds, jobs, whenOf)} />}
        </DeleteFrame>
    );
}

export function ExcludeDeleteDialog({ row, jobs, onClose, onDeleted }: DeleteProps<ExcludeRow>) {
    const patterns = resolveExcludePatterns(row);
    const folders = row.folders.length;
    const examples = patterns.slice(0, 2).map((pattern) => pattern.replace(/\/\*\*$/, ""));
    const blocked = row.isSystem ? { note: "Built in", description: "It ships with DBackup. Stop it as the default instead, or leave it unpicked." } : undefined;
    return (
        <DeleteFrame
            kind="exclude"
            name={row.name}
            run={() => deleteExcludePatternPreset(row.id)}
            onClose={onClose}
            onDeleted={onDeleted}
            blocked={blocked}
            note={folders > 0 ? `${count(folders, "folder")} ${folders === 1 ? "uses" : "use"} it` : undefined}
            description={
                folders > 0
                    ? `${folders === 1 ? "This folder loses" : "These folders lose"} its ${count(patterns.length, "pattern")}. From their next run they back up what it skipped${examples.length > 0 ? `, like ${examples.join(" and ")}` : ""}.`
                    : undefined
            }
            confirmLabel="Delete preset"
        >
            {!row.isSystem && folders > 0 && (
                <Holders
                    entries={row.folders.map((folder) => ({
                        key: folder.id,
                        href: jobHref(folder.jobId),
                        tile: <ConnectionRowTile adapterId={folder.adapterId} />,
                        name: folder.path,
                        detail: `folder of ${jobs.get(folder.jobId)?.name ?? "a job"} at ${folder.connectionName}`,
                    }))}
                />
            )}
        </DeleteFrame>
    );
}
