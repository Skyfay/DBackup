/**
 * The date and time formats a person picks in their profile, as date-fns patterns. `useDateFormatter`
 * puts the pick in place of the localized tokens `P` and `p`.
 */

export const DATE_FORMATS = [
    { value: "P", label: "Localized" },
    { value: "PP", label: "Medium" },
    { value: "PPP", label: "Long" },
    { value: "yyyy-MM-dd", label: "ISO" },
    { value: "dd/MM/yyyy", label: "Day first" },
    { value: "dd.MM.yyyy", label: "Day first with dots" },
] as const;

export const TIME_FORMATS = [
    { value: "p", label: "Localized" },
    { value: "pp", label: "Localized with seconds" },
    { value: "HH:mm", label: "24 hours" },
    { value: "HH:mm:ss", label: "24 hours with seconds" },
] as const;

export const DATE_FORMAT_VALUES = DATE_FORMATS.map((format) => format.value) as string[];
export const TIME_FORMAT_VALUES = TIME_FORMATS.map((format) => format.value) as string[];

/** A time zone this runtime knows, or empty for the one of the browser. */
export function isKnownTimezone(zone: string): boolean {
    if (zone === "") return true;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}
