import type { TemplateChannelConnection } from "@/services/templates/notification-template-service";

/** The runs a notification can go out after, in the order every list shows them. */
export const OUTCOMES = ["SUCCESS", "PARTIAL", "FAILED"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = { SUCCESS: "Succeeded", PARTIAL: "Partial", FAILED: "Failed" };

/** The status color of each run, for its dot and its chip. */
export const OUTCOME_DOTS: Record<Outcome, string> = { SUCCESS: "bg-success", PARTIAL: "bg-warning", FAILED: "bg-destructive" };
export const OUTCOME_CHIPS: Record<Outcome, string> = {
    SUCCESS: "bg-success/12 text-success",
    PARTIAL: "bg-warning/15 text-warning",
    FAILED: "bg-destructive/12 text-destructive",
};

/** A channel of a template: the connection it sends through and after which runs. */
export interface TemplateChannel {
    id: string;
    configId: string;
    /** Pipe-separated, like "PARTIAL|FAILED". */
    events: string;
    config: TemplateChannelConnection;
}

/** A notification template as the server hands it out, with how many jobs use it where it is known. */
export interface NotificationTemplateItem {
    id: string;
    name: string;
    description: string | null;
    isDefault: boolean;
    isSystem: boolean;
    channels: TemplateChannel[];
    _count?: { jobs: number };
}

/** "PARTIAL|FAILED" as its runs, in their usual order. Anything else in it is left out. */
export function parseOutcomes(events: string): Outcome[] {
    const parts = new Set(events.split("|"));
    return OUTCOMES.filter((outcome) => parts.has(outcome));
}

/** A channel that hears about runs of a job. */
export interface Listener {
    configId: string;
    name: string;
    adapterId: string;
    /** The templates it comes through, empty for a channel the job names directly. */
    via: string[];
    /** How many messages it gets after each run. */
    messages: Record<Outcome, number>;
}

/**
 * Who hears about a run of a job, the way the runner sends it: every channel of every template on
 * its own runs, so a channel in two templates gets two messages. A job without a template tells the
 * channels it names directly instead, after the runs it picked for all of them.
 */
export function listenersOf(templates: NotificationTemplateItem[], direct: TemplateChannelConnection[], directOutcomes: Outcome[]): Listener[] {
    const byChannel = new Map<string, Listener>();
    const hear = (channel: TemplateChannelConnection, via: string | null, outcomes: Outcome[]) => {
        const listener = byChannel.get(channel.id) ?? {
            configId: channel.id,
            name: channel.name,
            adapterId: channel.adapterId,
            via: [],
            messages: { SUCCESS: 0, PARTIAL: 0, FAILED: 0 },
        };
        if (via && !listener.via.includes(via)) listener.via.push(via);
        for (const outcome of outcomes) listener.messages[outcome] += 1;
        byChannel.set(channel.id, listener);
    };

    if (templates.length > 0) {
        for (const template of templates) {
            for (const channel of template.channels) hear(channel.config, template.name, parseOutcomes(channel.events));
        }
    } else {
        for (const channel of direct) hear(channel, null, directOutcomes);
    }
    return [...byChannel.values()].filter((listener) => OUTCOMES.some((outcome) => listener.messages[outcome] > 0));
}

function channels(count: number): string {
    return count === 1 ? "1 channel hears" : `${count} channels hear`;
}

/** What a run tells, led by the failed one, which matters most: "After a failed run 2 channels hear about it, after a successful one 1." */
export function summaryOf(listeners: Listener[]): { text: string; silentFailure: boolean } {
    const count = (outcome: Outcome) => listeners.filter((listener) => listener.messages[outcome] > 0).length;
    const failed = count("FAILED");
    const succeeded = count("SUCCESS");
    if (failed === 0) return { text: "Nobody hears about a failed run.", silentFailure: true };
    return { text: `After a failed run ${channels(failed)} about it, after a successful one ${succeeded === 0 ? "nobody" : succeeded}.`, silentFailure: false };
}

const RUN_WORDS: Record<Outcome, string> = { SUCCESS: "successful", PARTIAL: "partial", FAILED: "failed" };
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five"];

/** "a failed run", "partial and failed runs" or "every run". */
export function runsPhrase(outcomes: Outcome[]): string {
    if (outcomes.length === OUTCOMES.length) return "every run";
    if (outcomes.length === 1) return `a ${RUN_WORDS[outcomes[0]]} run`;
    return `${outcomes.map((outcome) => RUN_WORDS[outcome]).join(" and ")} runs`;
}

/** Why a channel gets the same news more than once: "#ops is in Ops alerts and Team chat, so it gets two messages after a failed run." */
export function repeatsOf(listeners: Listener[]): { configId: string; text: string }[] {
    return listeners.flatMap((listener) => {
        const twice = OUTCOMES.filter((outcome) => listener.messages[outcome] > 1);
        if (twice.length === 0) return [];
        const most = Math.max(...twice.map((outcome) => listener.messages[outcome]));
        const via = listener.via.length > 1 ? `${listener.via.slice(0, -1).join(", ")} and ${listener.via[listener.via.length - 1]}` : listener.via[0];
        return [{ configId: listener.configId, text: `${listener.name} is in ${via}, so it gets ${COUNT_WORDS[most] ?? most} messages after ${runsPhrase(twice)}.` }];
    });
}
