/**
 * A cron expression in words, "Every day at 03:00", for the ones people pick most. Anything
 * else stays the expression itself. Times are those of the scheduler's time zone.
 */
import { describeSimple, parseCron } from "./schedule-model";

const pad = (value: string) => value.padStart(2, "0");

export interface ScheduleWords {
    text: string;
    /** False when the expression could not be put into words and is shown as it is. */
    described: boolean;
}

export function describeSchedule(cron: string): ScheduleWords {
    const expression = cron.trim().replace(/\s+/g, " ");
    const simple = parseCron(expression);
    if (simple) return { text: describeSimple(simple), described: true };

    // The steps the picker does not offer, written the same way.
    const parts = expression.split(" ");
    const raw = { text: expression, described: false };
    if (parts.length !== 5) return raw;
    const [minute, hour, day, month, weekday] = parts;
    if (month !== "*" || day !== "*" || weekday !== "*") return raw;
    if (minute === "*" && hour === "*") return { text: "Every minute", described: true };
    const everyMinutes = minute.match(/^\*\/(\d+)$/);
    if (everyMinutes && hour === "*") return { text: `Every ${everyMinutes[1]} minutes`, described: true };
    const everyHours = hour.match(/^\*\/(\d+)$/);
    if (/^\d{1,2}$/.test(minute) && everyHours) {
        return { text: `Every ${everyHours[1]} hours${minute === "0" ? "" : ` at :${pad(minute)}`}`, described: true };
    }
    return raw;
}
