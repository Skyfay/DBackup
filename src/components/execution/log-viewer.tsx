"use client";

import React, { useRef, useEffect, useState, useMemo } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Terminal,
  ChevronRight,
  ChevronDown,
  ArrowDown,
  Loader2,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogEntry } from "@/lib/core/logs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { DateDisplay } from "@/components/utils/date-display";

interface LogViewerProps {
  logs: (LogEntry | string)[];
  className?: string;
  autoScroll?: boolean;
  status?: string; // Overall job status
}

interface LogGroup {
    stage: string;
    logs: LogEntry[];
    status: 'pending' | 'running' | 'success' | 'failed';
    startTime?: string;
}

export function LogViewer({ logs, className, autoScroll = true, status }: LogViewerProps) {
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
            stage: "General" // Fallback stage
        } as LogEntry;
     });
  }, [logs]);

  // Grouping Logic
  const groupedLogs = useMemo(() => {
      const groups: LogGroup[] = [];
      let currentGroup: LogGroup | null = null;

      parsedLogs.forEach(log => {
          // Normalize stage name by removing parenthesis content (e.g. "Dumping (50%)" -> "Dumping")
          // Also remove trailing ellipsis "..." and trim whitespace
          const rawStage = log.stage || "General";
          const stageName = rawStage.replace(/\s*\(.*\).*$/, "").replace(/\.{3,}$/, "").trim();

          if (!currentGroup || currentGroup.stage !== stageName) {
              // Finish previous group status check
              if (currentGroup) {
                  const hasError = currentGroup.logs.some(l => l.level === 'error');
                  if (hasError) currentGroup.status = 'failed';
                  else currentGroup.status = 'success'; // Assume success if moved to next stage without error
              }

              // Start new group
                  // Start new group
                  currentGroup = {
                      stage: stageName,
                      logs: [],
                      status: 'running', // Initially running
                      startTime: log.timestamp
                  };
                  groups.push(currentGroup);
              }

              currentGroup.logs.push(log);
              if (log.level === 'error') currentGroup.status = 'failed';
          });

          return groups;
      }, [parsedLogs]);
  // Auto-expand latest running stage only if user hasn't manually collapsed/expanded things
  useEffect(() => {
     if (userInteracted) return;

     const lastGroup = groupedLogs[groupedLogs.length - 1];
     if (lastGroup) {
         setActiveStages(prev => {
             // If the last group is not in the active list, switch to it ONLY.
             // This effectively collapses previous success stages.
             if (!prev.includes(lastGroup.stage)) {
                 return [lastGroup.stage];
             }
             return prev;
         });
     }
     // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedLogs.length, userInteracted]);

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
    <div className={cn("rounded-md border border-border bg-popover text-sm font-mono shadow-sm relative flex flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 w-full p-4 overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
      >
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
                const isRunning = group.status === 'running' &&
                                  groupIdx === groupedLogs.length - 1 &&
                                  (!status || status === 'Running');

                return (
                    <AccordionItem
                        key={`${group.stage}-${groupIdx}`}
                        value={group.stage}
                        className="border border-border rounded-lg bg-card/30 px-2 data-[state=open]:bg-card/50 transition-colors"
                    >
                        <AccordionTrigger className="hover:no-underline py-3 px-2">
                             <div className="flex items-center gap-3 w-full">
                                {group.status === 'failed' ? (
                                    <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" />
                                ) : isRunning ? (
                                    <Loader2 className="w-4 h-4 text-blue-500 dark:text-blue-400 animate-spin" />
                                ) : (
                                    <CheckCircle2 className="w-4 h-4 text-green-500 dark:text-green-400" />
                                )}

                                <span className={cn(
                                    "font-semibold",
                                    group.status === 'failed' ? "text-red-500 dark:text-red-400" :
                                    isRunning ? "text-blue-500 dark:text-blue-400" : "text-green-500 dark:text-green-400"
                                )}>
                                    {group.stage}
                                </span>

                                <span className="ml-auto text-xs text-muted-foreground font-normal mr-4">
                                    {group.logs.length} logs
                                </span>
                             </div>
                        </AccordionTrigger>
                        <AccordionContent className="pt-2 pb-4 px-2 border-t border-border/50">
                             <div className="space-y-1 pl-2 border-l border-border ml-2">
                                {group.logs.map((log, idx) => (
                                    <LogItem key={`${log.timestamp}-${idx}`} entry={log} />
                                ))}
                             </div>
                        </AccordionContent>
                    </AccordionItem>
                );
            })}
        </Accordion>
      </div>

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

function LogItem({ entry }: { entry: LogEntry }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const hasDetails = !!entry.details || !!entry.context;
  const isCommand = entry.type === "command";

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
           <DateDisplay date={entry.timestamp} format="pp" />
        </div>

        {/* Icon & Message Container */}
        <div className="flex-1 min-w-0">
          <div
            className="flex items-start gap-2 cursor-pointer select-none"
            onClick={() => hasDetails && setIsOpen(!isOpen)}
          >
            <div className={cn("shrink-0 pt-0.5", levelColor)}>
               {isCommand ? <Terminal className="w-3.5 h-3.5" /> : <LevelIcon className="w-3.5 h-3.5" />}
            </div>

            <div className="flex-1">
                <div className="flex items-center gap-2">
                    <span className={cn("text-sm break-all", entry.level === 'error' ? "text-destructive" : "text-foreground")}>
                         {entry.message}
                    </span>
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
