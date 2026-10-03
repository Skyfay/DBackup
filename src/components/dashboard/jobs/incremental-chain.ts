/**
 * The chains an incremental job builds on its schedule, for the Incremental part of the job form.
 *
 * Plain functions without React, so the tests check them without rendering anything.
 */
import { getTimezoneOffset } from "date-fns-tz";
import { readCronAtOffset } from "@/lib/core/cron";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many runs are worked out at most, a month of hourly runs with room to spare. */
export const MAX_RUNS = 1000;

/** A chain with more backups than a month of daily ones is long enough to warn about. */
export const LONG_CHAIN = 31;

/** How many chains in a row are looked at, since a schedule like weekdays makes chains of different lengths. */
const CHAINS = 3;

/** What a long chain is offered instead, round numbers of days, the most first. */
const SHORTER = [30, 14, 7, 3, 2, 1];

/**
 * The start times of the next runs, read at the offset the scheduler's time zone has now. A change
 * of daylight saving time would otherwise make the chain of that week one run longer, and croner is
 * about fifty times faster at a fixed offset. None for a schedule it cannot read.
 */
export function upcomingRuns(schedule: string, timezone: string, from = new Date()): number[] {
    const measured = Math.round(getTimezoneOffset(timezone, from) / 60_000);
    const cron = readCronAtOffset(schedule, Number.isFinite(measured) ? measured : 0);
    return cron?.nextRuns(MAX_RUNS, from).map((run) => run.getTime()) ?? [];
}

/** How many backups the chains of a schedule hold. */
export interface ChainSize {
    /** The chain that starts with the next run. */
    first: number;
    /** The shortest and the longest of the next few chains. */
    fewest: number;
    most: number;
    /** The first chain goes on past the runs worked out, so it holds at least `first`. */
    open: boolean;
}

/**
 * The chains the runs make with a full backup every `days` days, the way the chain planner decides:
 * the next run is a full backup, and every run after it adds to the chain until one starts `days`
 * or more after that full, which is the full of the next chain.
 */
export function chainSize(runs: number[], days: number): ChainSize | null {
    if (runs.length === 0 || !Number.isFinite(days) || days < 1) return null;
    const span = days * DAY_MS;
    const lengths: number[] = [];
    let start = 0;
    for (let index = 1; index < runs.length && lengths.length < CHAINS; index++) {
        if (runs[index] - runs[start] >= span) {
            lengths.push(index - start);
            start = index;
        }
    }
    if (lengths.length === 0) return { first: runs.length, fewest: runs.length, most: runs.length, open: true };
    return { first: lengths[0], fewest: Math.min(...lengths), most: Math.max(...lengths), open: false };
}

/** Whether chains this long are worth a warning. */
export function isLongChain(size: ChainSize): boolean {
    return size.open || size.most > LONG_CHAIN;
}

/** A setting with shorter chains, and how long those are. */
export interface ShorterChains {
    days: number;
    size: ChainSize;
}

/**
 * What to offer instead of long chains: the most days of a round number whose chains are not long,
 * or a full backup every day, the shortest there is, when none of them does. Nothing when the chains
 * are not long, or a full backup every day is set already.
 */
export function shorterChains(runs: number[], days: number): ShorterChains | null {
    const size = chainSize(runs, days);
    if (!size || !isLongChain(size) || days <= 1) return null;
    for (const candidate of SHORTER) {
        if (candidate >= days) continue;
        const shorter = chainSize(runs, candidate);
        if (shorter && !isLongChain(shorter)) return { days: candidate, size: shorter };
    }
    const daily = chainSize(runs, 1);
    return daily && !daily.open ? { days: 1, size: daily } : null;
}
