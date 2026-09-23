/**
 * A cron expression in words, "Every day at 03:00", for the ones people pick most. Anything
 * else stays the expression itself. Times are those of the scheduler's time zone.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const isNumber = (part: string) => /^\d{1,2}$/.test(part);
const pad = (value: string) => value.padStart(2, "0");

export interface ScheduleWords {
    text: string;
    /** False when the expression could not be put into words and is shown as it is. */
    described: boolean;
}

export function describeSchedule(cron: string): ScheduleWords {
    const expression = cron.trim().replace(/\s+/g, " ");
    const parts = expression.split(" ");
    const raw = { text: expression, described: false };
    if (parts.length !== 5) return raw;

    const [minute, hour, day, month, weekday] = parts;
    if (month !== "*") return raw;
    const at = isNumber(minute) && isNumber(hour) ? `${pad(hour)}:${pad(minute)}` : null;

    if (minute === "*" && hour === "*" && day === "*" && weekday === "*") return { text: "Every minute", described: true };
    const everyMinutes = minute.match(/^\*\/(\d+)$/);
    if (everyMinutes && hour === "*" && day === "*" && weekday === "*") return { text: `Every ${everyMinutes[1]} minutes`, described: true };

    if (isNumber(minute) && day === "*" && weekday === "*") {
        const past = minute === "0" ? "" : ` at :${pad(minute)}`;
        if (hour === "*") return { text: `Every hour${past}`, described: true };
        const everyHours = hour.match(/^\*\/(\d+)$/);
        if (everyHours) return { text: `Every ${everyHours[1]} hours${past}`, described: true };
    }

    if (!at) return raw;
    if (day === "*" && weekday === "*") return { text: `Every day at ${at}`, described: true };
    if (day === "*" && weekday === "1-5") return { text: `Weekdays at ${at}`, described: true };
    if (day === "*" && (weekday === "0,6" || weekday === "6,0")) return { text: `Weekends at ${at}`, described: true };
    if (day === "*" && /^[0-7]$/.test(weekday)) return { text: `Every ${DAYS[Number(weekday)]} at ${at}`, described: true };
    if (isNumber(day) && weekday === "*") return { text: `Monthly on day ${Number(day)} at ${at}`, described: true };
    return raw;
}
