/**
 * The dot beside a page tab. It shows while its list holds something that is wrong right now and
 * someone can fix, like a connection that does not answer or a job whose last run failed. A count
 * or a log is no reason for it: the dot says the list needs a look, the list says what and how many.
 */

export type AttentionTone = "warning" | "destructive";

export interface TabAttention {
    /** Red for what fails, amber for what will or might. */
    tone: AttentionTone;
    /** What needs a look in a few words, on hover and for screen readers. */
    note: string;
}

/**
 * "NAS", "NAS and S3", "NAS and 2 more". `total` counts them when only the first names are at hand,
 * like the ones a paged list gets from the server.
 */
export function namesFor(names: string[], total = names.length): string {
    if (total <= 1) return names[0] ?? "";
    if (total === 2 && names.length >= 2) return `${names[0]} and ${names[1]}`;
    return `${names[0]} and ${total - 1} more`;
}

/** An attention naming who it is about, with the verb for one or for more, or none without names. */
export function attentionOf(tone: AttentionTone, names: string[], one: string, many: string, total = names.length): TabAttention | undefined {
    if (total === 0 || names.length === 0) return undefined;
    return { tone, note: `${namesFor(names, total)} ${total === 1 ? one : many}` };
}

/** Several reasons of one list as one dot: red when any is, their notes as sentences, the red ones first. */
export function combineAttention(...parts: (TabAttention | undefined)[]): TabAttention | undefined {
    const present = parts.filter((part): part is TabAttention => part !== undefined);
    if (present.length === 0) return undefined;
    const ordered = [...present.filter((part) => part.tone === "destructive"), ...present.filter((part) => part.tone === "warning")];
    return { tone: ordered[0].tone, note: ordered.map((part) => part.note).join(". ") };
}
