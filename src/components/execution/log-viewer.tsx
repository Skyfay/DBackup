"use client";

import React, { useRef, useEffect, useState } from "react";
import { format } from "date-fns";
import {
  CheckCircle2,
  Info,
  AlertCircle,
  Terminal,
  ChevronRight,
  ChevronDown,
  Clock,
  ArrowDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogEntry } from "@/lib/core/logs";

interface LogViewerProps {
  logs: (LogEntry | string)[]; // Supports legacy strings and new objects
  className?: string;
  autoScroll?: boolean;
}

export function LogViewer({ logs, className, autoScroll = true }: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(autoScroll);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Scroll to bottom on new logs if sticky
  useEffect(() => {
    if (shouldAutoScroll && scrollRef.current) {
        const div = scrollRef.current;
        // Check if smooth scrolling causes issues with rapid updates (can lag behind)
        // For logs, instant jump is often better or very fast smooth
        div.scrollTo({ top: div.scrollHeight, behavior: "smooth" });
    }
  }, [logs, shouldAutoScroll]);

  const handleScroll = () => {
      if (!scrollRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Tolerance of 50px
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
      setIsAtBottom(atBottom);

      // If user scrolls up, disable auto-scroll
      if (!atBottom && shouldAutoScroll) {
          setShouldAutoScroll(false);
      }
      // If user hits bottom clearly, re-enable auto-scroll
      if (atBottom && !shouldAutoScroll) {
          setShouldAutoScroll(true);
      }
  };

  const scrollToBottom = () => {
      setShouldAutoScroll(true);
      if (scrollRef.current) {
          scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      }
  };

  const parseLog = (log: LogEntry | string): LogEntry => {
    if (typeof log === "string") {
      // Legacy fallback parser: try to parse if it is a JSON string, else treat as text
      try {
        const parsed = JSON.parse(log);
        if (parsed && parsed.timestamp && parsed.level) {
           return parsed;
        }
      } catch {
        // Not a JSON object, fall through
      }

      const parts = log.split(": ");
      const potentialDate = parts[0] || "";
      const date = (potentialDate.length > 10 && !isNaN(Date.parse(potentialDate)))
        ? potentialDate
        : new Date().toISOString();

      const message = parts.length > 1 ? parts.slice(1).join(": ") : log;

      return {
        timestamp: date,
        level: "info",
        type: "general",
        message: message,
      };
    }
    return log;
  };

  return (
    <div className={cn("rounded-md border bg-zinc-950 text-sm font-mono shadow-sm relative flex flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 w-full p-4 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent"
      >
        <div className="space-y-4">
          {logs.map((rawLog, idx) => {
            const log = parseLog(rawLog);
            return <LogItem key={`${log.timestamp}-${idx}`} entry={log} />;
          })}
        </div>
      </div>

      {!shouldAutoScroll && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-8 bg-emerald-500 hover:bg-emerald-600 text-white p-2 rounded-full shadow-lg animate-in fade-in transition-all z-10"
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
    info: "text-blue-400",
    success: "text-emerald-400",
    warning: "text-amber-400",
    error: "text-red-400",
  }[entry.level] || "text-zinc-400";

  return (
    <div className="group relative pl-4">
      {/* Timeline Line */}
      <div
        className={cn(
          "absolute left-0 top-2 bottom-0 w-px bg-white/10 group-last:bottom-auto group-last:h-4",
          entry.level === 'error' && "bg-red-500/20",
          entry.level === 'success' && "bg-emerald-500/20"
        )}
      />

      {/* Header Row */}
      <div className="flex items-start gap-4 py-1">
        {/* Timestamp */}
        <div className="shrink-0 text-xs text-zinc-500 w-[70px] pt-1">
           {isValidDate(entry.timestamp) ? format(new Date(entry.timestamp), "HH:mm:ss") : "--:--:--"}
        </div>

        {/* Icon & Message Container */}
        <div className="flex-1 min-w-0">
          <div
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={() => hasDetails && setIsOpen(!isOpen)}
          >
            <div className={cn("shrink-0", levelColor)}>
               {isCommand ? <Terminal className="w-4 h-4" /> : <LevelIcon className="w-4 h-4" />}
            </div>

            <div className="flex-1 flex items-center justify-between gap-4">
                <span className={cn("truncate", entry.level === 'error' ? "text-red-300" : "text-zinc-300")}>
                    {entry.message}
                </span>

                <div className="flex items-center gap-2">
                    {entry.durationMs && (
                        <span className="text-xs text-zinc-600 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {entry.durationMs}ms
                        </span>
                    )}
                    {hasDetails && (
                        <button className="text-zinc-500 hover:text-zinc-300 transition-colors">
                            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                    )}
                </div>
            </div>
          </div>

          {/* Details Section */}
          {hasDetails && isOpen && (
            <div className="mt-2 ml-6 text-xs animate-in slide-in-from-top-1 duration-200">
                {entry.details && (
                    <div className="bg-zinc-900 rounded border border-white/5 p-3 overflow-x-auto">
                        <pre className="text-zinc-400 font-mono whitespace-pre-wrap break-all">
                            {entry.details}
                        </pre>
                    </div>
                )}
                {entry.context && (
                    <div className="mt-2 bg-zinc-900/50 rounded p-3 border border-white/5">
                        <pre className="text-zinc-500">
                            {JSON.stringify(entry.context, null, 2)}
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

function isValidDate(dateStr: string) {
    const d = new Date(dateStr);
    return !isNaN(d.getTime());
}
