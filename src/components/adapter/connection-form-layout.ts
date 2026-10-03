/**
 * The parts of a connection form, and how far each one is filled in.
 *
 * Plain data without React, so the form renders what this describes and the tests check it
 * without rendering anything.
 */

/** Values the form keeps outside the config. The prefix keeps them apart from every config key. */
export const NAME_KEY = "$name";
export const LOGIN_KEY = "$login";
export const SSH_LOGIN_KEY = "$sshLogin";
/** Whether an OAuth app has been let into its cloud drive. */
export const AUTHORIZED_KEY = "$authorized";

export type SectionId =
    | "connection" | "ssh" | "database" | "file" | "aliases" | "transfer"
    | "service" | "location" | "options" | "speed" | "message" | "behavior";

export interface SectionLayout {
    id: SectionId;
    label: string;
    /** One line under the title, saying what the part is for. */
    description?: string;
    /** The keys shown in this part. An error on one of them is counted here. */
    keys: string[];
    /** The keys that need a value before the part counts as done. Empty for a part that is all optional. */
    expects: string[];
}

export type SectionStatus =
    | { kind: "none" }
    | { kind: "done" }
    | { kind: "todo" }
    | { kind: "error"; count: number };

/** Whether a field holds something, typed or put there as a default. */
export function hasValue(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

/**
 * The part an error belongs to. A key no part lists counts toward the first one, so an
 * error can never sit somewhere the user has no way to see it.
 */
export function sectionOfKey(layout: SectionLayout[], key: string): SectionId {
    return layout.find((section) => section.keys.includes(key))?.id ?? layout[0].id;
}

/**
 * The keys that failed validation, from react-hook-form's error tree.
 *
 * Only the first level of the config counts: an error deep inside a list, like one alias of
 * several, still belongs to the part that shows the list.
 */
export function errorKeysOf(errors: { name?: unknown; config?: unknown }): string[] {
    const keys: string[] = [];
    if (errors.name) keys.push(NAME_KEY);
    if (errors.config && typeof errors.config === "object") {
        for (const [key, value] of Object.entries(errors.config)) {
            // An error on the config object itself carries these, not a field name.
            if (key === "message" || key === "type" || key === "ref" || key === "root") continue;
            if (value) keys.push(key);
        }
    }
    return keys;
}

/**
 * How far each part is. Errors win, and a part only shows a check when it expects
 * something and has it, so a part that is all optional stays quiet.
 */
export function sectionStatuses(layout: SectionLayout[], values: Record<string, unknown>, errorKeys: string[]): Record<string, SectionStatus> {
    const errors = new Map<SectionId, number>();
    for (const key of new Set(errorKeys)) {
        const id = sectionOfKey(layout, key);
        errors.set(id, (errors.get(id) ?? 0) + 1);
    }

    const statuses: Record<string, SectionStatus> = {};
    for (const section of layout) {
        const count = errors.get(section.id) ?? 0;
        if (count > 0) statuses[section.id] = { kind: "error", count };
        else if (section.expects.length === 0) statuses[section.id] = { kind: "none" };
        else statuses[section.id] = section.expects.every((key) => hasValue(values[key])) ? { kind: "done" } : { kind: "todo" };
    }
    return statuses;
}

/** The first part with an error, in the order the form lists them. */
export function firstSectionWithError(layout: SectionLayout[], errorKeys: string[]): SectionId | null {
    const failing = new Set(errorKeys.map((key) => sectionOfKey(layout, key)));
    return layout.find((section) => failing.has(section.id))?.id ?? null;
}
