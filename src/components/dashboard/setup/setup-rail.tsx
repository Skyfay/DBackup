"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SetupStep, SetupStepId } from "./setup-model";

export interface RailEntry {
    step: SetupStep;
    status: "done" | "skipped" | "todo";
    /** What the step created or picked, or what it is for until then. */
    detail: string;
}

function Mark({ status }: { status: RailEntry["status"] }) {
    if (status === "done") {
        return (
            <>
                <Check className="size-3.5 shrink-0 text-success" strokeWidth={2.5} aria-hidden="true" />
                <span className="sr-only">, done</span>
            </>
        );
    }
    if (status === "skipped") return <span className="sr-only">, skipped</span>;
    return (
        <>
            <span className="inline-block size-2 shrink-0 rounded-full border-[1.5px] border-muted-foreground/60" aria-hidden="true" />
            <span className="sr-only">, still to do</span>
        </>
    );
}

interface SetupRailProps {
    entries: RailEntry[];
    current: SetupStepId | null;
    /** Whether a step can be opened again, the ones already reached until the job exists. */
    canOpen: (id: SetupStepId) => boolean;
    onOpen: (id: SetupStepId) => void;
}

/**
 * The steps on the left, like the parts of the connection form, each with what it created. A
 * phone has no room beside the step and goes without, the head of the step says where it is.
 */
export function SetupRail({ entries, current, canOpen, onOpen }: SetupRailProps) {
    return (
        <nav aria-label="Setup steps" className="hidden w-60 shrink-0 border-r bg-page/60 p-2.5 md:block">
            <ol className="grid gap-0.5">
                {entries.map(({ step, status, detail }) => {
                    const Icon = step.icon;
                    const isCurrent = step.id === current;
                    return (
                        <li key={step.id}>
                            <button
                                type="button"
                                disabled={!canOpen(step.id)}
                                aria-current={isCurrent ? "step" : undefined}
                                onClick={() => onOpen(step.id)}
                                className={cn(
                                    "flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left text-muted-foreground outline-none transition-[color,background-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 enabled:hover:text-foreground",
                                    isCurrent && "bg-background text-foreground shadow-sm dark:bg-foreground/12"
                                )}
                            >
                                <Icon className="size-4 shrink-0" aria-hidden="true" />
                                <span className="grid min-w-0 flex-1 gap-0.5">
                                    <span className={cn("truncate text-sm font-medium", (isCurrent || status === "done") && "text-foreground")}>{step.title}</span>
                                    <span className="truncate text-xs text-muted-foreground" title={detail}>{detail}</span>
                                </span>
                                <Mark status={status} />
                            </button>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
