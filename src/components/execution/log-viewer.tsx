"use client";

import React, { useRef, useEffect, useState, useMemo, startTransition } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Terminal,
  FolderInput,
  ChevronRight,
  ChevronDown,
  ArrowDown,
  Loader2,
  Info,
  Clock
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { LogEntry, BACKUP_STAGE_ORDER, RESTORE_STAGE_ORDER, INTEGRITY_CHECK_STAGE_ORDER, VERIFICATION_STAGE_ORDER } from "@/lib/core/logs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DateDisplay } from "@/components/utils/date-display";

interface LogViewerProps {
  logs: (LogEntry | string)[];
  className?: string;
  autoScroll?: boolean;
  status?: string; // Overall job status
  executionType?: string; // "Backup" | "Restore"
  systemTimezone?: string; // System timezone for timestamps
}

interface LogGroup {
    stage: string;
    logs: LogEntry[];
    status: 'pending' | 'running' | 'success' | 'failed' | 'partial';
    startTime?: string;
    endTime?: string;
    durationMs?: number;
}

export function LogViewer({ logs, className, autoScroll = true, status, executionType, systemTimezone = "UTC" }: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(autoScroll);
  const [activeStages, setActiveStages] = useState<string[]>([]);
  const [userInteracted, setUserInteracted] = useState(false);

  // Parse Logs Helper
  const parsedLogs = useMemo(() => {
     return logs.map(rawLog => {
        if (typeof rawLog === "object") return rawLog;

        // Legacy string parsing
        try { return JSON.parse(rawLog) as LogEntry; } catch {}

        const parts = rawLog.split(": ");
        return {
            timestamp: parts[0]?.length > 10 ? parts[0] : new Date().toISOString(),
            level: "info",
            type: "general",
            message: parts.slice(1).join(": ") || rawLog,
            stage: "General"
        } as LogEntry;
     });
  }, [logs]);

  // Grouping Logic - group by stage, sort by stage order, fill pending stages
  const groupedLogs = useMemo(() => {
      const stageOrder = executionType === "Restore"
          ? RESTORE_STAGE_ORDER
          : executionType === "IntegrityCheck"
              ? INTEGRITY_CHECK_STAGE_ORDER
              : executionType === "Verification"
                  ? VERIFICATION_STAGE_ORDER
                  : BACKUP_STAGE_ORDER;

      // Build a map of stage → logs
      const stageMap = new Map<string, LogEntry[]>();
      parsedLogs.forEach(log => {
          const stage = log.stage || "General";
          if (!stageMap.has(stage)) stageMap.set(stage, []);
          stageMap.get(stage)!.push(log);
      });

      // Determine which known stages appeared
      const seenStages = new Set(stageMap.keys());
      const isRunning = !status || status === "Running";

      // Find the furthest known stage reached (by stage order index)
      let maxStageIdx = -1;
      for (const stage of seenStages) {
          const idx = stageOrder.indexOf(stage);
          if (idx > maxStageIdx) maxStageIdx = idx;
      }

      const groups: LogGroup[] = [];

      // Add known pipeline stages in order
      for (let i = 0; i < stageOrder.length; i++) {
          const stage = stageOrder[i];
          const stageLogs = stageMap.get(stage);

          if (stageLogs && stageLogs.length > 0) {
              const hasError = stageLogs.some(l => l.level === "error");
              const isLast = i === maxStageIdx;
              const firstTs = stageLogs[0].timestamp;
              const lastTs = stageLogs[stageLogs.length - 1].timestamp;
              const duration = new Date(lastTs).getTime() - new Date(firstTs).getTime();

              const isPartialStage = stage === "Uploading" || stage === "Verifying Checksums";
              const isOverallPartial = status === "Partial";
              groups.push({
                  stage,
                  logs: stageLogs,
                  status: hasError
                      ? (isPartialStage && isOverallPartial ? "partial" : "failed")
                      : (isLast && isRunning) ? "running" : "success",
                  startTime: firstTs,
                  endTime: lastTs,
                  durationMs: duration >= 0 ? duration : undefined,
              });

              stageMap.delete(stage);
          } else if (isRunning && i > maxStageIdx && maxStageIdx >= 0) {
              // Pending future stage
              groups.push({ stage, logs: [], status: "pending" });
          }
      }

      // Append any non-pipeline stages (e.g. "General") at the end
      for (const [stage, stageLogs] of stageMap) {
          const hasError = stageLogs.some(l => l.level === "error");
          groups.push({
              stage,
              logs: stageLogs,
              status: hasError ? "failed" : "success",
              startTime: stageLogs[0].timestamp,
          });
      }

      return groups;
  }, [parsedLogs, status, executionType]);
  // Track the currently running stage so the effect fires when it transitions.
  const runningStage = useMemo(
      () => groupedLogs.find(g => g.status === "running")?.stage ?? null,
      [groupedLogs]
  );

  // Auto-expand the active stage; collapse the previous one.
  useEffect(() => {
      if (userInteracted) return;
      if (!runningStage) return;
      const stage = runningStage;
      startTransition(() => {
          setActiveStages(prev => {
              if (prev.includes(stage)) return prev;
              return [stage];
          });
      });
  }, [runningStage, userInteracted]);

  // Scroll to bottom on new logs if sticky
  useEffect(() => {
    if (shouldAutoScroll && scrollRef.current) {
        const div = scrollRef.current;
        div.scrollTo({ top: div.scrollHeight, behavior: "smooth" });
    }
  }, [logs, shouldAutoScroll]);

  const handleScroll = () => {
      if (!scrollRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;

      if (!atBottom && shouldAutoScroll) setShouldAutoScroll(false);
      if (atBottom && !shouldAutoScroll) setShouldAutoScroll(true);
  };

  const scrollToBottom = () => {
      setShouldAutoScroll(true);
      if (scrollRef.current) {
          scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      }
  };

  return (
    <div className={cn("rounded-md border border-border bg-popover text-sm font-mono shadow-sm relative flex flex-col overflow-hidden", className)}>
      <ScrollArea
        viewportRef={scrollRef}
        className="flex-1 h-0"
        onScrollCapture={handleScroll}
      >
        <div className="p-4">
        <Accordion
            type="multiple"
            value={activeStages}
            onValueChange={(vals) => {
                setActiveStages(vals);
                setUserInteracted(true);
            }}
            className="space-y-4"
        >
            {groupedLogs.map((group, groupIdx) => {
                const isPending = group.status === "pending";

                if (isPending) {
                    return (
                        <div
                            key={`${group.stage}-${groupIdx}`}
                            className="border border-border/40 rounded-lg bg-card/10 px-4 py-3 opacity-40"
                        >
                            <div className="flex items-center gap-3">
                                <Clock className="w-4 h-4 text-muted-foreground" />
                                <span className="font-semibold text-muted-foreground">{group.stage}</span>
                            </div>
                        </div>
                    );
                }

                const StageIcon = group.status === "failed" || group.status === "partial" ? AlertCircle
                    : group.status === "running" ? Loader2
                    : CheckCircle2;

                const stageColor = group.status === "failed" ? "text-red-500 dark:text-red-400"
                    : group.status === "partial" ? "text-orange-500 dark:text-orange-400"
                    : group.status === "running" ? "text-blue-500 dark:text-blue-400"
                    : "text-green-500 dark:text-green-400";

                return (
                    <AccordionItem
                        key={`${group.stage}-${groupIdx}`}
                        value={group.stage}
                        className="border border-border rounded-lg bg-card/30 px-2 data-[state=open]:bg-card/50 transition-colors"
                    >
                        <AccordionTrigger className="hover:no-underline py-3 px-2">
                             <div className="flex items-center gap-3 w-full">
                                <StageIcon className={cn("w-4 h-4 shrink-0", stageColor, group.status === "running" && "animate-spin")} />

                                <span className={cn("font-semibold", stageColor)}>
                                    {group.stage}
                                </span>

                                <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground font-normal mr-4">
                                    {group.durationMs != null && (
                                        <span>{formatDuration(group.durationMs)}</span>
                                    )}
                                    <span>{group.logs.length} {group.logs.length === 1 ? "log" : "logs"}</span>
                                </div>
                             </div>
                        </AccordionTrigger>
                        <AccordionContent className="pt-2 pb-4 px-2 border-t border-border/50">
                             <div className="space-y-1 pl-2 border-l border-border ml-2">
                                {group.logs.map((log, idx) => (
                                    <LogItem key={`${log.timestamp}-${idx}`} entry={log} systemTimezone={systemTimezone} />
                                ))}
                             </div>
                        </AccordionContent>
                    </AccordionItem>
                );
            })}
        </Accordion>
        </div>
      </ScrollArea>

      {!shouldAutoScroll && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-8 bg-blue-500 hover:bg-blue-600 text-white p-2 rounded-full shadow-lg animate-in fade-in transition-all z-10"
            title="Scroll to bottom"
          >
              <ArrowDown className="w-4 h-4" />
          </button>
      )}
    </div>
  );
}

function LogItem({ entry, systemTimezone = "UTC" }: { entry: LogEntry; systemTimezone?: string }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const hasDetails = !!entry.details || !!entry.context;
  const isCommand = entry.type === "command";
  const isStorage = entry.type === "storage";

  const LevelIcon = {
    info: Info,
    success: CheckCircle2,
    warning: AlertCircle,
    error: AlertCircle,
  }[entry.level] || Info;

  const levelColor = {
    info: "text-blue-500 dark:text-blue-400",
    success: "text-green-500 dark:text-green-400",
    warning: "text-amber-500 dark:text-amber-400",
    error: "text-red-500 dark:text-red-400",
  }[entry.level] || "text-muted-foreground";

  return (
    <div className="group relative pl-2 hover:bg-accent/50 rounded px-2 transition-colors">
      <div className="flex items-start gap-3 py-1">
        {/* Timestamp */}
        <div className="shrink-0 text-xs text-muted-foreground w-20 pt-0.5 font-mono">
           <DateDisplay date={entry.timestamp} format="pp" timezone={systemTimezone} />
        </div>

        {/* Icon & Message Container */}
        <div className="flex-1 min-w-0">
          <div
            className="flex items-start gap-2 cursor-pointer select-none"
            onClick={() => hasDetails && setIsOpen(!isOpen)}
          >
            <div className={cn("shrink-0 pt-0.5", levelColor)}>
               {isCommand ? <Terminal className="w-3.5 h-3.5" /> : isStorage ? <FolderInput className="w-3.5 h-3.5" /> : <LevelIcon className="w-3.5 h-3.5" />}
            </div>

            <div className="flex-1">
                <div className="flex items-center gap-2">
                    <span className={cn("text-sm break-all", entry.level === 'error' ? "text-destructive" : "text-foreground")}>
                         {entry.message}
                    </span>
                    {entry.durationMs != null && (
                        <span className="shrink-0 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                            {formatDuration(entry.durationMs)}
                        </span>
                    )}
                    {hasDetails && (
                         <span className="text-muted-foreground">
                             {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                         </span>
                    )}
                </div>
            </div>
          </div>

          {/* Details Section */}
          {hasDetails && isOpen && (
            <div className="mt-2 ml-5 text-xs animate-in slide-in-from-top-1 duration-200">
                {entry.details && (
                    <div className="bg-popover rounded border border-border p-3 overflow-x-auto">
                        <pre className="text-muted-foreground font-mono whitespace-pre-wrap break-all">
                            {entry.details}
                        </pre>
                    </div>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// function isValidDate(dateStr: string) {
//    const d = new Date(dateStr);
//    return !isNaN(d.getTime());
// }
