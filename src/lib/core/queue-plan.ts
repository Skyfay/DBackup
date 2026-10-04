/**
 * When the queue starts each run. It takes runs in the order they are due, as many at once as it
 * has slots, and never two runs of one job at once, like `processQueue` does. The Jobs page draws
 * the result: how long a run waits and for which jobs. Plain functions, so the rules can be tested.
 */

/** A run as the queue sees it. */
export interface QueueItem {
    key: string;
    jobId: string;
    /** When it is due: the time of its schedule, or when it was queued. */
    due: number;
    /** How long it is expected to take. */
    durationMs: number;
    /** When it started, for a run that holds a slot already. */
    startedAt?: number;
}

export interface QueuedRun {
    start: number;
    end: number;
    /** How long it waits for a slot, from when it was due. */
    waitMs: number;
    /** The jobs whose runs hold the slots while it waits, its own first when an earlier run of it is still going. */
    waitsFor: string[];
}

interface Slot {
    end: number;
    jobId: string | null;
}

function earliest(slots: Slot[]): number {
    let index = 0;
    for (let slot = 1; slot < slots.length; slot++) if (slots[slot].end < slots[index].end) index = slot;
    return index;
}

/**
 * Plans every run: the ones that started hold their slot until they are expected to end, and
 * never before now, then the others take the slots in the order they are due, none before now.
 */
export function planQueue(items: QueueItem[], slots: number, now: number): Map<string, QueuedRun> {
    const plan = new Map<string, QueuedRun>();
    const free: Slot[] = Array.from({ length: Math.max(1, Math.floor(slots)) }, () => ({ end: Number.NEGATIVE_INFINITY, jobId: null }));
    const lastEnd = new Map<string, number>();

    const started = items.filter((item) => item.startedAt !== undefined).sort((a, b) => a.startedAt! - b.startedAt!);
    for (const item of started) {
        const end = Math.max(item.startedAt! + item.durationMs, now);
        free[earliest(free)] = { end, jobId: item.jobId };
        lastEnd.set(item.jobId, Math.max(lastEnd.get(item.jobId) ?? Number.NEGATIVE_INFINITY, end));
        plan.set(item.key, { start: item.startedAt!, end, waitMs: 0, waitsFor: [] });
    }

    const waiting = items.filter((item) => item.startedAt === undefined).sort((a, b) => a.due - b.due || a.key.localeCompare(b.key));
    for (const item of waiting) {
        const index = earliest(free);
        const own = lastEnd.get(item.jobId) ?? Number.NEGATIVE_INFINITY;
        const start = Math.max(item.due, now, free[index].end, own);
        const waitsFor: string[] = [];
        if (start > Math.max(item.due, now)) {
            if (own > item.due) waitsFor.push(item.jobId);
            for (const slot of free) if (slot.jobId && slot.end > item.due && !waitsFor.includes(slot.jobId)) waitsFor.push(slot.jobId);
        }
        const end = start + Math.max(item.durationMs, 1);
        free[index] = { end, jobId: item.jobId };
        lastEnd.set(item.jobId, end);
        plan.set(item.key, { start, end, waitMs: start - item.due, waitsFor });
    }
    return plan;
}
