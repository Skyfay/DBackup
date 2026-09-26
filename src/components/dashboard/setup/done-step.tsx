"use client";

import { useId } from "react";
import Link from "next/link";
import { Loader2, PartyPopper, Play } from "lucide-react";
import { useRunJob } from "@/components/dashboard/widgets/use-run-job";
import { Button } from "@/components/ui/button";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { nextRun, type SetupJob, type SetupState } from "./setup-model";

interface DoneCardProps {
    state: SetupState;
    job: SetupJob;
    schedulerTimezone: string;
    canRunJob: boolean;
    canOpenVault: boolean;
}

/** The setup is done: when the first run starts and the way to it, above the parts that say what was made. */
export function DoneCard({ state, job, schedulerTimezone, canRunJob, canOpenVault }: DoneCardProps) {
    const titleId = useId();
    const { formatDate } = useDateFormatter();
    // Starts the job like Run now on the Overview, which opens the run when the user wants that.
    const { runJob, startingJobId } = useRunJob();
    const next = nextRun(job.schedule, schedulerTimezone);

    return (
        <section aria-labelledby={titleId} className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5">
            <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/12 text-success" aria-hidden="true">
                    <PartyPopper className="size-4.5" />
                </span>
                <div className="min-w-0">
                    <h2 id={titleId} className="text-base font-semibold">
                        Your first backup is set up
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        {next ? `The first run starts ${formatDate(next, "Pp")}.` : "Everything is saved."}
                        {state.encryption && ` Download the recovery kit of ${state.encryption.name} in the Vault, without it the backups cannot be opened.`}
                    </p>
                </div>
            </div>
            {/* A report like the result of a bulk action, so its buttons are outline and ghost. The green reports and never colors a button. */}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button asChild variant="ghost">
                    <Link href="/dashboard">Go to the overview</Link>
                </Button>
                {canOpenVault && state.encryption && (
                    <Button asChild variant="outline">
                        <Link href="/dashboard/vault">Open the Vault</Link>
                    </Button>
                )}
                {canRunJob && (
                    <Button type="button" variant="outline" disabled={startingJobId !== null} onClick={() => runJob(job.id, job.name)}>
                        {startingJobId ? <Loader2 className="animate-spin" /> : <Play />}
                        Run it now
                    </Button>
                )}
            </div>
        </section>
    );
}
