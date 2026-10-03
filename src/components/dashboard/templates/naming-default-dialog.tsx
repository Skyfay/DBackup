"use client";

import { useState } from "react";
import { FileText, Star } from "lucide-react";
import { toast } from "sonner";
import { updateNamingTemplate } from "@/app/actions/templates";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { NamingRow, TemplateJob } from "@/services/templates/templates-types";
import { nextFileOf } from "./naming-cells";
import { count } from "./template-format";

const log = logger.child({ component: "NamingDefaultDialog" });

interface NamingDefaultDialogProps {
    template: NamingRow;
    /** The template that is the default now, whose followers move over. */
    current: NamingRow | null;
    jobs: Map<string, TemplateJob>;
    timezone: string;
    onClose: () => void;
    onDone: () => void;
}

/** Asks before a template becomes the default, with the next file of every job that follows the default. */
export function NamingDefaultDialog({ template, current, jobs, timezone, onClose, onDone }: NamingDefaultDialogProps) {
    const [pending, setPending] = useState(false);
    const followers = (current?.uses ?? [])
        .filter((use) => use.how === "default")
        .map((use) => jobs.get(use.jobId))
        .filter((job): job is TemplateJob => job !== undefined);

    const confirm = async () => {
        setPending(true);
        try {
            const result = await updateNamingTemplate(template.id, { isDefault: true });
            if (result.success) {
                toast.success(`${template.name} is the default template now`);
                onDone();
                return;
            }
            toast.error(result.error || "The default could not be changed.");
        } catch (error: unknown) {
            // Without the right to write templates the action throws instead of answering.
            log.warn("The default naming template could not be changed", { templateId: template.id }, wrapError(error));
            toast.error("The default could not be changed.");
        } finally {
            setPending(false);
        }
    };

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            icon={Star}
            title={`Make ${template.name} the default?`}
            note={followers.length > 0 ? `${count(followers.length, "job")} ${followers.length === 1 ? "follows" : "follow"} the default` : "No job follows the default yet"}
            description={
                followers.length > 0
                    ? `From their next run the jobs without a template of their own are named by it${current ? ` instead of ${current.name}` : ""}. Their backups so far keep their names.`
                    : "From now on a job without a template of its own is named by it."
            }
            confirmLabel="Make default"
            isPending={pending}
            onConfirm={confirm}
        >
            {followers.length > 0 && (
                <DialogItemList
                    size="small"
                    items={followers.map((job) => ({ name: nextFileOf(template.pattern, job, timezone), detail: job.name, icon: FileText }))}
                />
            )}
        </ConfirmDialog>
    );
}
