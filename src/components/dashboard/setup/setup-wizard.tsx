"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { ConnectionStep, type ConnectionStepId } from "./connection-step";
import { DoneCard } from "./done-step";
import { EncryptionStep } from "./encryption-step";
import type { ExistingEntry } from "./existing-list";
import { JobStep } from "./job-step";
import type { JobDraft } from "./job-values";
import { EMPTY_SETUP, NOTIFY_ON, entryLabel, scheduleName, setupSteps, type SetupEntry, type SetupState, type SetupStep, type SetupStepId } from "./setup-model";
import { SetupPreview } from "./setup-preview";
import { DoneSection, TodoSection } from "./setup-sections";

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

/** What a part made, in one line, or null while it holds nothing. */
function valueOf(id: SetupStepId, state: SetupState): string | null {
    if (id === "job") return state.job && `${state.job.name} · ${scheduleName(state.job.schedule)}`;
    const entry = state[id];
    if (!entry) return null;
    // Once the job exists, the channel also says when it hears from it.
    if (id === "notification" && state.job) return `${entryLabel(entry)} · ${state.job.notifyOn === NOTIFY_ON.always ? "after every run" : "when a run fails"}`;
    return entryLabel(entry);
}

/** The first part that holds nothing and was not skipped, the one to open once a part is done. */
function firstOpen(steps: SetupStep[], state: SetupState): number {
    const index = steps.findIndex((step) => valueOf(step.id, state) === null && !state.skipped.includes(step.id));
    return index === -1 ? steps.length : index;
}

interface SetupWizardProps {
    canCreateVault: boolean;
    canCreateNotification: boolean;
    canRunJob: boolean;
    canOpenVault: boolean;
    /** The keys in the Vault, for the encryption part to offer. */
    keys: ExistingEntry[];
}

/**
 * The first backup on one page: a database, where the backups go, a key and a channel if wanted,
 * and the job that ties them together. The parts sit one under the other, the open one in full and
 * the others in a line with what they made, and the backup they add up to fills in beside them.
 * The connections are added with the dialogs of the Connections page, so there is only one form
 * to keep up.
 */
export function SetupWizard({ canCreateVault, canCreateNotification, canRunJob, canOpenVault, keys: vaultKeys }: SetupWizardProps) {
    const steps = useMemo(() => setupSteps({ canCreateVault, canCreateNotification }), [canCreateVault, canCreateNotification]);
    const [current, setCurrent] = useState<SetupStepId | null>(steps[0].id);
    const [reached, setReached] = useState(0);
    const [state, setState] = useState<SetupState>(EMPTY_SETUP);
    const [keys, setKeys] = useState(vaultKeys);
    const [jobDraft, setJobDraft] = useState<JobDraft | null>(null);
    const schedulerTimezone = useSchedulerTimezone();

    // The part that opens, or the result once the job exists, comes into view. Not on the first
    // render, which starts at the top of the page anyway.
    const activeRef = useRef<HTMLDivElement>(null);
    const shown = useRef(current);
    useEffect(() => {
        if (shown.current === current) return;
        shown.current = current;
        activeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [current]);

    const open = (target: number) => {
        setCurrent(target < steps.length ? steps[target].id : null);
        setReached((furthest) => Math.max(furthest, target));
    };

    /** Keeps what a part made, or that it was skipped, and opens the first part still empty. */
    const finish = (id: Exclude<SetupStepId, "job">, entry: SetupEntry | null) => {
        const next: SetupState = {
            ...state,
            [id]: entry,
            skipped: entry ? state.skipped.filter((skipped) => skipped !== id) : [...state.skipped.filter((skipped) => skipped !== id), id],
        };
        setState(next);
        open(firstOpen(steps, next));
    };

    const renderOpen = (step: SetupStep, number: number) => {
        if (step.id === "encryption") {
            return (
                <EncryptionStep
                    number={number}
                    step={step}
                    keys={keys}
                    picked={state.encryption}
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
                    number={number}
                    step={step}
                    state={state}
                    draft={jobDraft}
                    onDraftChange={setJobDraft}
                    schedulerTimezone={schedulerTimezone}
                    onDone={(job) => {
                        setState((previous) => ({ ...previous, job }));
                        open(steps.length);
                    }}
                />
            );
        }
        const id: ConnectionStepId = step.id;
        return (
            <ConnectionStep
                number={number}
                step={{ ...step, id }}
                picked={state[id]}
                onSkip={step.optional ? () => finish(id, null) : undefined}
                onDone={(entry) => finish(id, entry)}
            />
        );
    };

    const renderPart = (step: SetupStep, index: number) => {
        const number = index + 1;
        if (step.id === current) {
            return (
                <div key={step.id} ref={activeRef} className="scroll-mt-4">
                    {renderOpen(step, number)}
                </div>
            );
        }
        // Once the job exists the parts are its parts, and changing one would no longer reach it.
        const change = state.job ? undefined : () => open(index);
        const value = valueOf(step.id, state);
        if (value) return <DoneSection key={step.id} number={number} step={step} value={value} onChange={change} />;
        if (state.skipped.includes(step.id)) return <DoneSection key={step.id} number={number} step={step} value="Skipped, add one later" skipped onChange={change} />;
        return <TodoSection key={step.id} number={number} step={step} onOpen={index <= reached ? change : undefined} />;
    };

    return (
        <>
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Quick Setup</h1>
            <div className="grid items-start gap-4 md:gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
                <div className="min-w-0 space-y-3">
                    {state.job && (
                        <div ref={activeRef} className="scroll-mt-4">
                            <DoneCard state={state} job={state.job} schedulerTimezone={schedulerTimezone} canRunJob={canRunJob} canOpenVault={canOpenVault} />
                        </div>
                    )}
                    {steps.map(renderPart)}
                </div>
                <SetupPreview state={state} draft={jobDraft} parts={steps.map((step) => step.id)} />
            </div>
        </>
    );
}
