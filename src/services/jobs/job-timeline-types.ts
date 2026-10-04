/**
 * What the Timeline and Upcoming views of the Jobs page show: the runs of every job a week back
 * and a week ahead, with where the queue makes one wait. Shared with the browser, so types only.
 */

/** A run that happened, runs now or waits in the queue. */
export interface TimelineRun {
    id: string;
    jobId: string;
    /** Success, Failed, Partial, Cancelled, Running or Pending. */
    status: string;
    /** When it started, or when it was queued while it is Pending. */
    startedAt: string;
    endedAt: string | null;
    stage: string | null;
    progress: number | null;
    /** For a run that runs or waits: when it is expected to start and to end. */
    expectedStart: string | null;
    expectedEnd: string | null;
    /** For a run that waits: the jobs whose runs hold the slots. */
    waitsFor: string[];
}

/** A run the schedule of a job plans, with where the queue puts it. */
export interface TimelinePlannedRun {
    jobId: string;
    /** When the schedule starts it. */
    due: string;
    /** When the queue is expected to start it, later than due while it waits for a slot. */
    start: string;
    end: string;
    waitsFor: string[];
}

export interface JobTimeline {
    now: string;
    /** The range loaded, a week back and a week ahead. The views cut their own range from it. */
    from: string;
    to: string;
    /** Runs the queue takes at once. */
    slots: number;
    /** The usual length of a run per job id, from its last runs. */
    estimates: Record<string, number>;
    /** Jobs whose newest outcome failed, so their next runs are marked. */
    failing: string[];
    /** Done, running and queued runs, oldest first. */
    runs: TimelineRun[];
    /** Soonest first. */
    planned: TimelinePlannedRun[];
    /** Jobs that run so often their plan was cut short. */
    truncated: string[];
}
