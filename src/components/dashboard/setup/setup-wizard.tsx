"use client";

import { useEffect, useMemo, useState } from "react";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { ConnectionStep, type ConnectionStepId } from "./connection-step";
import { DoneStep } from "./done-step";
import { EncryptionStep } from "./encryption-step";
import type { ExistingEntry } from "./existing-list";
import { JobStep } from "./job-step";
import type { JobDraft } from "./job-values";
import { EMPTY_SETUP, entryLabel, scheduleName, setupSteps, type SetupEntry, type SetupState, type SetupStepId } from "./setup-model";
import { SetupRail, type RailEntry } from "./setup-rail";

const log = logger.child({ component: "SetupWizard" });

/** The time zone the scheduler reads cron expressions in, UTC until the server says otherwise. */
function useSchedulerTimezone(): string {
    const [timezone, setTimezone] = useState("UTC");
    useEffect(() => {
        fetch("/api/system/timezone")
            .then((res) => (res.ok ? res.json() : null))
            .then((body) => {
                if (typeof body?.schedulerTimezone === "string") setTimezone(body.schedulerTimezone);
            })
            .catch((error: unknown) => log.warn("Scheduler time zone could not be loaded", {}, wrapError(error)));
    }, []);
    return timezone;
}

function railEntries(steps: ReturnType<typeof setupSteps>, state: SetupState): RailEntry[] {
    return steps.map((step) => {
        if (step.id === "job" && state.job) return { step, status: "done", detail: `${state.job.name} · ${scheduleName(state.job.schedule)}` };
        const entry = step.id === "job" ? null : state[step.id];
        if (entry) return { step, status: "done", detail: entryLabel(entry) };
        if (state.skipped.includes(step.id)) return { step, status: "skipped", detail: "Skipped" };
        return { step, status: "todo", detail: step.todo };
    });
}

interface SetupWizardProps {
    canCreateVault: boolean;
    canCreateNotification: boolean;
    canRunJob: boolean;
    canOpenVault: boolean;
    /** The keys in the Vault, for the encryption step to offer. */
    keys: ExistingEntry[];
}

/**
 * The first backup, step by step: a database, where the backups go, a key and a channel if
 * wanted, and the job that ties them together. The steps are listed on the left with what each
 * made, the step itself is on the right, and saving one moves on to the next. The connections are
 * added with the form of the Connections page, so there is only one form to keep up.
 */
export function SetupWizard({ canCreateVault, canCreateNotification, canRunJob, canOpenVault, keys: vaultKeys }: SetupWizardProps) {
    const steps = useMemo(() => setupSteps({ canCreateVault, canCreateNotification }), [canCreateVault, canCreateNotification]);
    const [current, setCurrent] = useState<SetupStepId | null>(steps[0].id);
    const [reached, setReached] = useState(0);
    const [state, setState] = useState<SetupState>(EMPTY_SETUP);
    const [keys, setKeys] = useState(vaultKeys);
    const [jobDraft, setJobDraft] = useState<JobDraft | null>(null);
    const schedulerTimezone = useSchedulerTimezone();

    const index = current ? steps.findIndex((step) => step.id === current) : steps.length;
    const position = `Step ${index + 1} of ${steps.length}`;

    const open = (target: number) => {
        setCurrent(target < steps.length ? steps[target].id : null);
        setReached((furthest) => Math.max(furthest, target));
    };
    const back = index > 0 ? () => open(index - 1) : undefined;

    /** Keeps what a step made, or that it was skipped, and moves on. */
    const finish = (id: Exclude<SetupStepId, "job">, entry: SetupEntry | null) => {
        setState((previous) => ({
            ...previous,
            [id]: entry,
            skipped: entry ? previous.skipped.filter((skipped) => skipped !== id) : [...previous.skipped.filter((skipped) => skipped !== id), id],
        }));
        open(index + 1);
    };

    const renderStep = () => {
        const step = steps[index];
        if (!step) {
            return state.job && (
                <DoneStep steps={steps} state={state} job={state.job} schedulerTimezone={schedulerTimezone} canRunJob={canRunJob} canOpenVault={canOpenVault} />
            );
        }
        if (step.id === "encryption") {
            return (
                <EncryptionStep
                    step={step}
                    position={position}
                    keys={keys}
                    picked={state.encryption}
                    onBack={() => open(index - 1)}
                    onSkip={() => finish("encryption", null)}
                    onDone={(entry) => {
                        setKeys((current) => (current.some((key) => key.id === entry.id) ? current : [{ ...entry, detail: "" }, ...current]));
                        finish("encryption", entry);
                    }}
                />
            );
        }
        if (step.id === "job") {
            return (
                <JobStep
                    step={step}
                    position={position}
                    state={state}
                    draft={jobDraft}
                    onDraftChange={setJobDraft}
                    schedulerTimezone={schedulerTimezone}
                    onBack={() => open(index - 1)}
                    onDone={(job) => {
                        setState((previous) => ({ ...previous, job }));
                        open(steps.length);
                    }}
                />
            );
        }
        const id: ConnectionStepId = step.id;
        return (
            // Keyed, so the next connection step starts on its own list instead of the one before.
            <ConnectionStep
                key={id}
                step={{ ...step, id }}
                position={position}
                picked={state[id]}
                onBack={back}
                onSkip={step.optional ? () => finish(id, null) : undefined}
                onDone={(entry) => finish(id, entry)}
            />
        );
    };

    return (
        <div className="space-y-4 md:space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Quick Setup</h1>
                <p className="text-sm text-muted-foreground">Your first backup in a few minutes.</p>
            </div>
            <div className="flex min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
                <SetupRail
                    entries={railEntries(steps, state)}
                    current={current}
                    // Once the job exists the steps are its parts, and changing one would no longer reach it.
                    canOpen={(id) => !state.job && steps.findIndex((step) => step.id === id) <= reached}
                    onOpen={(id) => open(steps.findIndex((step) => step.id === id))}
                />
                <div className="flex min-w-0 flex-1 flex-col">{renderStep()}</div>
            </div>
        </div>
    );
}
