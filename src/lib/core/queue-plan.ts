import { pickFairly, type LastServed } from "./queue-fairness";

/**
 * When the queue starts each run. It takes as many runs at once as it has slots, never two runs of
 * one job at once, and gives a free slot to the tenant whose turn it is and inside a tenant to the
 * run that is due first (`pickFairly`), like `processQueue` does. The Jobs page draws the result:
 * how long a run waits and for which jobs. Plain functions, so the rules can be tested.
 */

/** A run as the queue sees it. */
export interface QueueItem {
    key: string;
    jobId: string;
    /** The tenant of its job. Runs without one count as runs of one tenant. */
    tenantId?: string;
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
    start: number;
    end: number;
    jobId: string | null;
    tenantId?: string;
}

function earliest(slots: Slot[]): number {
    let index = 0;
    for (let slot = 1; slot < slots.length; slot++) if (slots[slot].end < slots[index].end) index = slot;
    return index;
}

/**
 * Plans every run: the ones that started hold their slot until they are expected to end, and
 * never before now. The others take the slots as they free up, none before now and none before it
 * is due. A run whose job still runs steps aside for the next one, and among the runs that are due
 * the slot goes to the tenant whose turn it is.
 */
export function planQueue(items: QueueItem[], slots: number, now: number): Map<string, QueuedRun> {
    const plan = new Map<string, QueuedRun>();
    const free: Slot[] = Array.from({ length: Math.max(1, Math.floor(slots)) }, () => ({ start: Number.NEGATIVE_INFINITY, end: Number.NEGATIVE_INFINITY, jobId: null }));
    const lastEnd = new Map<string, number>();
    const lastServed: LastServed = new Map();

    const started = items.filter((item) => item.startedAt !== undefined).sort((a, b) => a.startedAt! - b.startedAt!);
    for (const item of started) {
        const end = Math.max(item.startedAt! + item.durationMs, now);
        free[earliest(free)] = { start: item.startedAt!, end, jobId: item.jobId, tenantId: item.tenantId };
        lastEnd.set(item.jobId, Math.max(lastEnd.get(item.jobId) ?? Number.NEGATIVE_INFINITY, end));
        lastServed.set(item.tenantId, item.startedAt!);
        plan.set(item.key, { start: item.startedAt!, end, waitMs: 0, waitsFor: [] });
    }

    const before = (a: QueueItem, b: QueueItem) => a.due - b.due || a.key.localeCompare(b.key);
    const waiting = items.filter((item) => item.startedAt === undefined).sort(before);
    const ownEnd = (item: QueueItem) => lastEnd.get(item.jobId) ?? Number.NEGATIVE_INFINITY;
    // The runs that are due and wait for a slot, in the order they are due. Only the oldest run of
    // a job, the later ones wait behind it, so a job that is due far more often than it ends costs
    // one entry to look at, not one per run.
    const ready: QueueItem[] = [];
    const behind = new Map<string, QueueItem[]>();
    const admit = (item: QueueItem) => {
        const line = behind.get(item.jobId);
        if (line) line.push(item);
        else {
            behind.set(item.jobId, []);
            ready.push(item);
        }
    };
    const leave = (item: QueueItem) => {
        ready.splice(ready.indexOf(item), 1);
        const follower = behind.get(item.jobId)?.shift();
        if (!follower) {
            behind.delete(item.jobId);
            return;
        }
        let at = ready.length;
        while (at > 0 && before(follower, ready[at - 1]) < 0) at--;
        ready.splice(at, 0, follower);
    };
    let next = 0;

    while (next < waiting.length || ready.length > 0) {
        const index = earliest(free);
        let time = Math.max(now, free[index].end);
        if (ready.length === 0) time = Math.max(time, waiting[next].due);

        // The moment the slot is free and a run is due whose job does not run.
        let item: QueueItem | undefined;
        while (!item) {
            while (next < waiting.length && waiting[next].due <= time) admit(waiting[next++]);
            // Only once the earlier run of its job has ended.
            const reached = time;
            const able = ready.filter((candidate) => ownEnd(candidate) <= reached);
            if (able.length > 0) {
                const running = new Map<string | undefined, number>();
                for (const slot of free) if (slot.jobId && slot.end > time) running.set(slot.tenantId, (running.get(slot.tenantId) ?? 0) + 1);
                item = able[pickFairly(able, running, lastServed)];
                break;
            }
            // Every run that is due waits for a run of its own job: on to the first of them that
            // ends, or to the next run that gets due.
            let later = next < waiting.length ? waiting[next].due : Number.POSITIVE_INFINITY;
            for (const candidate of ready) later = Math.min(later, ownEnd(candidate));
            time = later;
        }
        leave(item);

        const own = ownEnd(item);
        const start = time;
        const waitsFor: string[] = [];
        if (start > Math.max(item.due, now)) {
            if (own > item.due) waitsFor.push(item.jobId);
            // A run that took its slot while this one stepped aside for its own job held nothing back.
            for (const slot of free) {
                const ahead = slot.start <= item.due || own <= slot.start;
                if (slot.jobId && slot.end > item.due && ahead && !waitsFor.includes(slot.jobId)) waitsFor.push(slot.jobId);
            }
        }
        const end = start + Math.max(item.durationMs, 1);
        free[index] = { start, end, jobId: item.jobId, tenantId: item.tenantId };
        lastEnd.set(item.jobId, end);
        lastServed.set(item.tenantId, start);
        plan.set(item.key, { start, end, waitMs: start - item.due, waitsFor });
    }
    return plan;
}
