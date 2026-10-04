import { describeProblem } from "@/services/history/known-problems";
import type { NotificationProblem, TemplateOptions } from "../types";
import { formatterFor } from "./format";

/** The plain words of a message, the way the page of a run tells it. */
export function problemOf(raw: string, subject: string | null, step: string, kind: "source" | "destination" | null, where?: string): NotificationProblem {
    const described = describeProblem(raw, "error", { subject, step, jobName: null, subjectKind: kind });
    return { title: described.title, ...(described.help ? { help: described.help } : {}), raw, ...(where ? { where } : {}) };
}

export function timeField(iso: string, options?: TemplateOptions) {
    return { name: "Time", value: formatterFor(options).date(iso) ?? iso, inline: true };
}

