import prisma from "@/lib/prisma";
import { LogEntry, LogLevel, LogType, INTEGRITY_CHECK_STAGE_PROGRESS_MAP } from "@/lib/core/logs";
import { createLogFlusher, LogFlusher } from "@/lib/execution/log-flusher";
import { formatDuration } from "@/lib/utils";

export class SystemTaskRunner {
  private executionId: string;
  private logs: LogEntry[] = [];
  private currentStage = "Initializing";
  private currentProgress = 0;
  private currentDetail = "";
  /** More state for whoever watches the run, like the checks of several copies. */
  private extra: Record<string, unknown> = {};
  private stageStartTimes = new Map<string, number>();
  private stageProgressMap: Record<string, [number, number]>;
  private flusher: LogFlusher;

  private constructor(
    executionId: string,
    stageProgressMap: Record<string, [number, number]>
  ) {
    this.executionId = executionId;
    this.stageProgressMap = stageProgressMap;
    this.flusher = createLogFlusher({
      executionId,
      getLogs: () => this.logs,
      getMetadata: () => ({
        ...this.extra,
        progress: this.currentProgress,
        stage: this.currentStage,
        detail: this.currentDetail,
      }),
    });
  }

  static async create(
    taskType: string,
    triggerType?: "Manual" | "Scheduler",
    triggerLabel?: string,
    stageProgressMap: Record<string, [number, number]> = INTEGRITY_CHECK_STAGE_PROGRESS_MAP
  ): Promise<SystemTaskRunner> {
    const initialLog: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      type: "general",
      message: "Task queued",
      stage: "Initializing",
    };

    const execution = await prisma.execution.create({
      data: {
        jobId: null,
        type: taskType,
        status: "Pending",
        logs: JSON.stringify([initialLog]),
        metadata: JSON.stringify({ progress: 0, stage: "Initializing" }),
        triggerType: triggerType ?? null,
        triggerLabel: triggerLabel ?? null,
      },
    });

    return new SystemTaskRunner(execution.id, stageProgressMap);
  }

  get id(): string {
    return this.executionId;
  }

  async start(): Promise<void> {
    const claimed = await prisma.execution.updateMany({
      where: { id: this.executionId, status: "Pending" },
      data: { status: "Running", startedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new Error("Execution already claimed by a concurrent call");
    }
  }

  async finish(status: "Success" | "Failed" | "Partial"): Promise<void> {
    await this.flushLogs(true);
    // Nothing deferred may land after the final write below, which carries the end status.
    this.flusher.dispose();
    await prisma.execution.update({
      where: { id: this.executionId },
      data: {
        status,
        endedAt: new Date(),
        logs: JSON.stringify(this.logs),
        metadata: JSON.stringify({
          ...this.extra,
          progress: this.currentProgress,
          stage: this.currentStage,
        }),
      },
    });
  }

  logEntry(message: string, level: LogLevel = "info", type: LogType = "general", details?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      type,
      message,
      stage: this.currentStage,
      details,
    };
    this.logs.push(entry);
    void this.flushLogs();
  }

  setStage(stage: string): void {
    const prevStart = this.stageStartTimes.get(this.currentStage);
    if (prevStart && this.currentStage !== stage) {
      const durationMs = Date.now() - prevStart;
      this.logs.push({
        timestamp: new Date().toISOString(),
        level: "success",
        type: "general",
        message: `${this.currentStage} completed (${formatDuration(durationMs)})`,
        stage: this.currentStage,
        durationMs,
      });
    }

    this.currentStage = stage;
    this.currentDetail = "";
    this.stageStartTimes.set(stage, Date.now());

    const range = this.stageProgressMap[stage];
    this.currentProgress = range ? range[0] : this.currentProgress;

    void this.flushLogs(true);
  }

  updateStageProgress(internalPercent: number): void {
    const range = this.stageProgressMap[this.currentStage];
    if (range) {
      const [min, max] = range;
      const clamped = Math.max(0, Math.min(100, internalPercent));
      this.currentProgress = Math.round(min + (max - min) * (clamped / 100));
    }
    void this.flushLogs();
  }

  /** Merges state into the metadata of the run, which the next flush writes. */
  setExtra(extra: Record<string, unknown>): void {
    this.extra = { ...this.extra, ...extra };
    void this.flushLogs();
  }

  /** Sets the progress of the whole run directly, for a run without fixed stages. */
  setProgress(percent: number): void {
    this.currentProgress = Math.round(Math.max(0, Math.min(100, percent)));
    void this.flushLogs();
  }

  updateDetail(detail: string): void {
    this.currentDetail = detail;
    void this.flushLogs();
  }

  async flushLogs(force = false): Promise<void> {
    if (force) {
      await this.flusher.flush();
      return;
    }
    this.flusher.schedule();
  }
}
