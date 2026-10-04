"use client";

import { Plus } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { cn } from "@/lib/utils";
import { entryLabel, SCHEDULES, scheduleName, type SetupEntry, type SetupState, type SetupStepId } from "./setup-model";
import type { JobDraft } from "./job-values";

function Node({ entry, empty }: { entry: SetupEntry | null; empty: string }) {
    if (!entry) {
        return (
            <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border-[1.5px] border-dashed border-input" aria-hidden="true">
                    <Plus className="size-4 text-muted-foreground" />
                </span>
                <span className="text-sm text-muted-foreground">{empty}</span>
            </div>
        );
    }
    return (
        <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                {entry.adapterId && <AdapterIcon adapterId={entry.adapterId} className="size-4.5" />}
            </span>
            <span className="min-w-0 truncate text-sm font-medium" title={entryLabel(entry)}>
                {entryLabel(entry)}
            </span>
        </div>
    );
}

function Fact({ name, value, muted }: { name: string; value: string; muted: boolean }) {
    return (
        <div className="flex items-center justify-between gap-3 py-2">
            <dt className="text-muted-foreground">{name}</dt>
            <dd className={cn("truncate text-right", muted ? "text-muted-foreground" : "font-medium")}>{value}</dd>
        </div>
    );
}

interface SetupPreviewProps {
    state: SetupState;
    /** What the job part holds while it is filled in. */
    draft: JobDraft | null;
    /** The optional parts this user has, which the facts leave out otherwise. */
    parts: SetupStepId[];
}

/**
 * The backup the setup makes, beside the parts: from the database to where the backups go, with
 * the schedule, the key and the channel. It fills in as the parts are done.
 */
export function SetupPreview({ state, draft, parts }: SetupPreviewProps) {
    const schedule = state.job?.schedule ?? (draft ? (draft.values.when === "custom" ? draft.values.cron : SCHEDULES[draft.values.when]) : null);
    const optional = (id: "encryption" | "notification") => {
        const entry = state[id];
        if (entry) return { value: entry.name, muted: false };
        return { value: state.skipped.includes(id) || state.job ? "None" : "None yet", muted: true };
    };

    return (
        <aside aria-label="Your first backup" className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5 xl:sticky xl:top-4">
            <h2 className="text-base font-semibold">Your first backup</h2>
            <p className="text-sm text-muted-foreground">{state.job ? "Set up and saved" : "Fills in as you go"}</p>
            <div className="mt-4">
                <Node entry={state.database} empty="What to back up" />
                <div className={cn("my-1 ml-[1.1rem] border-l-2 py-2.5 pl-5 text-xs", schedule ? "border-tone-control/60 text-foreground" : "border-dashed border-input text-muted-foreground")}>
                    {schedule ? `Backed up ${scheduleName(schedule)}` : "Backed up at a time still to pick"}
                </div>
                <Node entry={state.destination} empty="Where the backups go" />
            </div>
            <dl className="mt-4 divide-y border-t text-sm">
                <Fact name="Schedule" value={schedule ? capitalize(scheduleName(schedule)) : "Not set yet"} muted={!schedule} />
                {parts.includes("encryption") && <Fact name="Encryption" {...optional("encryption")} />}
                {parts.includes("notification") && <Fact name="Notifications" {...optional("notification")} />}
            </dl>
            {!state.job && (
                <p className="mt-3 text-xs text-muted-foreground">Connections are saved as you add them. The job is created in the last part, and nothing runs before it.</p>
            )}
        </aside>
    );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
