"use client";

import Link from "next/link";
import { Check, Loader2, PartyPopper, Play } from "lucide-react";
import { useRunJob } from "@/components/dashboard/widgets/use-run-job";
import { Button } from "@/components/ui/button";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { NOTIFY_ON, entryLabel, nextRun, scheduleName, type SetupJob, type SetupState, type SetupStep, type SetupStepId } from "./setup-model";
import { StepFrame } from "./step-frame";

/** What a step left behind, in one line, or null for a step that was skipped. */
function summaryOf(id: SetupStepId, state: SetupState, job: SetupJob): string | null {
    if (id === "job") return `${job.name} · ${scheduleName(job.schedule)}`;
    const entry = state[id];
    if (!entry) return null;
    if (id === "notification") return `${entryLabel(entry)} · ${job.notifyOn === NOTIFY_ON.always ? "after every run" : "when a run fails"}`;
    return entryLabel(entry);
}

interface DoneStepProps {
    steps: SetupStep[];
    state: SetupState;
    job: SetupJob;
    schedulerTimezone: string;
    canRunJob: boolean;
    canOpenVault: boolean;
}

/** Everything the setup made, in one list, and the way to the first run. */
export function DoneStep({ steps, state, job, schedulerTimezone, canRunJob, canOpenVault }: DoneStepProps) {
    const { formatDate } = useDateFormatter();
    // Starts the job like Run now on the Overview, which opens the run when the user wants that.
    const { runJob, startingJobId } = useRunJob();
    const next = nextRun(job.schedule, schedulerTimezone);

    return (
        <StepFrame
            tone="success"
            icon={PartyPopper}
            title="Your first backup is set up"
            note="Everything is saved"
            fill={false}
            start={
                canOpenVault && state.encryption && (
                    <Button asChild variant="outline">
                        <Link href="/dashboard/vault">Open the Vault</Link>
                    </Button>
                )
            }
            end={
                <>
                    <Button asChild variant="ghost">
                        <Link href="/dashboard">Go to the overview</Link>
                    </Button>
                    {canRunJob && (
                        // A report like the result of a bulk action, so its buttons are outline and ghost.
                        // The green of the head reports and never colors a button.
                        <Button type="button" variant="outline" disabled={startingJobId !== null} onClick={() => runJob(job.id, job.name)}>
                            {startingJobId ? <Loader2 className="animate-spin" /> : <Play />}
                            Run it now
                        </Button>
                    )}
                </>
            }
        >
            <div className="px-5 pt-1 pb-5">
                <dl className="divide-y">
                    {steps.map((step) => {
                        const Icon = step.icon;
                        const summary = summaryOf(step.id, state, job);
                        return (
                            <div key={step.id} className="flex items-center gap-3 py-3">
                                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <div className="grid min-w-0 flex-1 gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center sm:gap-3">
                                    <dt className="text-xs text-muted-foreground sm:text-sm">{step.title}</dt>
                                    <dd className={summary ? "truncate text-sm font-medium" : "text-sm text-muted-foreground"} title={summary ?? undefined}>
                                        {summary ?? "Skipped"}
                                    </dd>
                                </div>
                                {summary && <Check className="size-4 shrink-0 text-success" strokeWidth={2.5} aria-hidden="true" />}
                            </div>
                        );
                    })}
                </dl>
                <p className="mt-4 text-sm text-muted-foreground">
                    {next && `The first run starts ${formatDate(next, "Pp")}.`}
                    {state.encryption && ` Download the recovery kit of ${state.encryption.name} in the Vault, without it the backups cannot be opened.`}
                </p>
            </div>
        </StepFrame>
    );
}
