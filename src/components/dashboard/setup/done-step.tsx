"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, PartyPopper, Play } from "lucide-react";
import { toast } from "sonner";
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
    const router = useRouter();
    const { formatDate } = useDateFormatter();
    const [running, setRunning] = useState(false);
    const next = nextRun(job.schedule, schedulerTimezone);

    const run = async () => {
        setRunning(true);
        try {
            const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/run`, { method: "POST" });
            if (res.ok) {
                toast.success("The first backup is running");
                router.push("/dashboard/history");
                return;
            }
            const body = await res.json().catch(() => null);
            toast.error(body?.error || "The job could not be started.");
        } catch {
            toast.error("The job could not be started.");
        }
        setRunning(false);
    };

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
                        // The button of a finished task, not of a new one, so it stays in the plain primary color.
                        <Button type="button" tone="neutral" disabled={running} onClick={run}>
                            {running ? <Loader2 className="animate-spin" /> : <Play />}
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
