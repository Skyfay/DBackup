import type { LogEntry } from "@/lib/core/logs";
import { describeProblem, type ProblemContext } from "./known-problems";
import { isStepSummary, SUMMARY_LINES } from "./run-steps";
import type { RunNotification, RunProblem, RunStep } from "./run-types";

/**
 * What to look at in a run: every error and warning of its log and every notification that did
 * not go out, told once. Lines about the same thing in the same step fold into one problem, so a
 * destination that was tried three times is one problem with its tries.
 */

/** The destinations and channels of the run, so a line naming one gets the button that opens it. */
export interface ProblemTargets {
    jobName: string | null;
    destinations: { id: string; name: string }[];
    sourceName: string | null;
    sourceId: string | null;
}

/** `[NAS Backups] Upload FAILED: ...` names its destination in brackets. */
export function subjectOf(message: string): { subject: string | null; text: string } {
    const match = message.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
    return match ? { subject: match[1], text: match[2] } : { subject: null, text: message };
}

/** The part of a line the server wrote, without what DBackup put in front of it. */
export function rawOf(text: string): string {
    return text.replace(/^(Upload FAILED|Integrity verification error|WARNING):\s*/i, "").trim();
}

/** Two tries of the same thing differ in their numbers, like the part or the wait. */
function sameKind(text: string): string {
    return text.replace(/\d+/g, "#").toLowerCase();
}

function contextFor(step: string, subject: string | null, targets: ProblemTargets): ProblemContext {
    const destination = subject ? targets.destinations.find((entry) => entry.name === subject) : undefined;
    if (destination) return { subject, step, jobName: targets.jobName, subjectKind: "destination", subjectId: destination.id };
    if (!subject && /dump|initializ|restor/i.test(step) && targets.sourceName) {
        return { subject: targets.sourceName, step, jobName: targets.jobName, subjectKind: "source", subjectId: targets.sourceId ?? undefined };
    }
    return { subject, step, jobName: targets.jobName, subjectKind: null };
}

/**
 * The times a thing was tried: warnings that came before its error, or one warning repeated. An error
 * written twice, once by the step and once for the whole run, is the same error and no second try.
 */
function triesOf(entries: LogEntry[]): string[] {
    const warnings = entries.filter((entry) => entry.level === "warning");
    const errors = entries.filter((entry) => entry.level === "error");
    if (errors.length > 0) return warnings.length > 0 ? [...warnings, errors.at(-1)!].map((entry) => entry.timestamp) : [];
    return warnings.length > 1 ? warnings.map((entry) => entry.timestamp) : [];
}

interface Group {
    step: string;
    subject: string | null;
    entries: LogEntry[];
}

/** The problems of a log, in the order they came up, with the ids their lines carry. */
export function buildProblems(entries: LogEntry[], notifications: RunNotification[], targets: ProblemTargets): { problems: RunProblem[]; lineProblems: Map<LogEntry, string> } {
    const groups: Group[] = [];
    for (const entry of entries) {
        if (entry.level !== "error" && entry.level !== "warning") continue;
        if (isStepSummary(entry) || SUMMARY_LINES.some((pattern) => pattern.test(entry.message))) continue;
        const step = entry.stage ?? "General";
        const { subject, text } = subjectOf(entry.message);
        // Warnings without an error stay apart by what they say, errors of one subject fold together.
        const group = groups.find((candidate) => candidate.step === step && candidate.subject === subject
            && (entry.level === "error" || candidate.entries.some((other) => other.level === "error") || candidate.entries.some((other) => sameKind(subjectOf(other.message).text) === sameKind(text))));
        if (group) group.entries.push(entry);
        else groups.push({ step, subject, entries: [entry] });
    }

    const problems: RunProblem[] = [];
    const lineProblems = new Map<LogEntry, string>();
    groups.forEach((group, index) => {
        const errors = group.entries.filter((entry) => entry.level === "error");
        const main = errors.at(-1) ?? group.entries.at(-1)!;
        const tone = errors.length > 0 ? "error" : "warning";
        const raw = rawOf(subjectOf(main.message).text);
        const context = contextFor(group.step, group.subject, targets);
        const described = describeProblem(raw, tone, context);
        const id = `p${index + 1}`;
        problems.push({
            id,
            tone,
            title: described.title,
            raw,
            step: group.step,
            subject: context.subject,
            at: main.timestamp,
            tries: triesOf(group.entries),
            help: described.help,
            actions: described.actions,
        });
        for (const entry of group.entries) lineProblems.set(entry, id);
    });

    for (const notification of notifications) {
        if (notification.status !== "Failed") continue;
        const raw = notification.error ?? "The channel did not take the message.";
        const context: ProblemContext = { subject: notification.channelName, step: "Sending Notifications", jobName: targets.jobName, subjectKind: "channel", subjectId: notification.channelId ?? undefined };
        const described = describeProblem(raw, "error", context);
        problems.push({
            id: `n${notification.id}`,
            tone: "error",
            title: described.title === `${notification.channelName} failed` ? `${notification.channelName} did not get the message` : described.title,
            raw,
            step: "Sending Notifications",
            subject: notification.channelName,
            at: notification.sentAt,
            tries: [],
            help: described.help ?? "Check the settings of the channel, a test from its connection shows what it answers.",
            actions: described.actions,
        });
    }

    // Errors first, then the warnings, each in the order they came up.
    problems.sort((a, b) => (a.tone === b.tone ? a.at.localeCompare(b.at) : a.tone === "error" ? -1 : 1));
    return { problems, lineProblems };
}

/** Mark the lines of every problem, and count a notification that failed on its step. */
export function markSteps(steps: RunStep[], lineProblems: Map<LogEntry, string>, problems: RunProblem[]): RunStep[] {
    const byLine = new Map<string, string>();
    for (const [entry, id] of lineProblems) byLine.set(`${entry.stage}|${entry.timestamp}|${entry.message}`, id);
    return steps.map((step) => {
        const failedChannels = problems.filter((problem) => problem.id.startsWith("n") && problem.step === step.name).length;
        return {
            ...step,
            errors: step.errors + failedChannels,
            state: failedChannels > 0 && step.state !== "running" ? "failed" : step.state,
            lines: step.lines.map((line) => {
                const id = byLine.get(`${step.name}|${line.at}|${line.message}`);
                return id ? { ...line, problem: id } : line;
            }),
        };
    });
}
