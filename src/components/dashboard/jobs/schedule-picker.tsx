"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/auth/client";
import { formatInTimeZone } from "date-fns-tz";
import { Clock, Terminal, CalendarClock } from "lucide-react";

type Frequency = "hourly" | "daily" | "weekly" | "monthly";

interface SimpleSchedule {
  frequency: Frequency;
  minute: number;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
}

const FREQUENCY_OPTIONS: { value: Frequency; label: string; icon: string }[] = [
  { value: "hourly", label: "Hourly", icon: "60m" },
  { value: "daily", label: "Daily", icon: "24h" },
  { value: "weekly", label: "Weekly", icon: "7d" },
  { value: "monthly", label: "Monthly", icon: "30d" },
];

const DAYS_OF_WEEK = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: String(i).padStart(2, "0"),
}));

const MINUTES = Array.from({ length: 60 }, (_, i) => ({
  value: String(i),
  label: String(i).padStart(2, "0"),
}));

const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

function buildCron(schedule: SimpleSchedule): string {
  const { frequency, minute, hour, dayOfWeek, dayOfMonth } = schedule;
  switch (frequency) {
    case "hourly":
      return `${minute} * * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return `${minute} ${hour} * * ${dayOfWeek}`;
    case "monthly":
      return `${minute} ${hour} ${dayOfMonth} * *`;
  }
}

function parseCron(cron: string): { mode: "simple"; schedule: SimpleSchedule } | { mode: "cron" } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { mode: "cron" };

  const [minPart, hourPart, domPart, monthPart, dowPart] = parts;

  const isNum = (s: string) => /^\d+$/.test(s);
  const isStar = (s: string) => s === "*";

  if (isNum(minPart) && isStar(hourPart) && isStar(domPart) && isStar(monthPart) && isStar(dowPart)) {
    return { mode: "simple", schedule: { frequency: "hourly", minute: Number(minPart), hour: 0, dayOfWeek: 0, dayOfMonth: 1 } };
  }
  if (isNum(minPart) && isNum(hourPart) && isStar(domPart) && isStar(monthPart) && isStar(dowPart)) {
    return { mode: "simple", schedule: { frequency: "daily", minute: Number(minPart), hour: Number(hourPart), dayOfWeek: 0, dayOfMonth: 1 } };
  }
  if (isNum(minPart) && isNum(hourPart) && isStar(domPart) && isStar(monthPart) && isNum(dowPart)) {
    return { mode: "simple", schedule: { frequency: "weekly", minute: Number(minPart), hour: Number(hourPart), dayOfWeek: Number(dowPart), dayOfMonth: 1 } };
  }
  if (isNum(minPart) && isNum(hourPart) && isNum(domPart) && isStar(monthPart) && isStar(dowPart)) {
    return { mode: "simple", schedule: { frequency: "monthly", minute: Number(minPart), hour: Number(hourPart), dayOfWeek: 0, dayOfMonth: Number(domPart) } };
  }

  return { mode: "cron" };
}

function describeSchedule(schedule: SimpleSchedule, formatTime: (hour: number, minute: number) => string, schedulerTimezone: string): string {
  const { frequency, minute, hour, dayOfWeek, dayOfMonth } = schedule;
  const time = formatTime(hour, minute);
  const day = DAYS_OF_WEEK.find((d) => d.value === String(dayOfWeek))?.label ?? "";
  const tz = ` (${schedulerTimezone})`;
  switch (frequency) {
    case "hourly":
      return `Runs every hour at minute :${String(minute).padStart(2, "0")}`;
    case "daily":
      return `Runs every day at ${time}${tz}`;
    case "weekly":
      return `Runs every ${day} at ${time}${tz}`;
    case "monthly":
      return `Runs on day ${dayOfMonth} of every month at ${time}${tz}`;
  }
}

interface SchedulePickerProps {
  value: string;
  onChange: (cron: string) => void;
}

export function SchedulePicker({ value, onChange }: SchedulePickerProps) {
  const { data: session } = useSession();
  // @ts-expect-error - types might not be generated yet
  const userTimeFormat: string = session?.user?.timeFormat || "p";

  // Scheduler timezone: controls when cron jobs actually fire.
  // This is the system.timezone setting, NOT the user profile timezone.
  const [schedulerTimezone, setSchedulerTimezone] = useState("UTC");

  useEffect(() => {
    fetch("/api/system/timezone")
      .then((res) => res.json())
      .then((data) => {
        if (data.schedulerTimezone) setSchedulerTimezone(data.schedulerTimezone);
      })
      .catch(() => { /* keep default UTC on error */ });
  }, []);

  // Format a cron hour/minute value in the scheduler timezone so the preview
  // reflects the time the job will actually run.
  const formatTime = useCallback((hour: number, minute: number) => {
    const refDate = new Date(2000, 0, 1, hour, minute, 0);
    return formatInTimeZone(refDate, schedulerTimezone, userTimeFormat);
  }, [schedulerTimezone, userTimeFormat]);

  const parsed = useMemo(() => parseCron(value), [value]);
  const initialMode = parsed.mode === "simple" ? "simple" : "cron";

  const schedule = useMemo<SimpleSchedule>(() =>
    parsed.mode === "simple"
      ? parsed.schedule
      : { frequency: "daily", minute: 0, hour: 0, dayOfWeek: 0, dayOfMonth: 1 },
    [parsed]
  );

  const [mode, setMode] = useState<"simple" | "cron">(initialMode);
  const [cronInput, setCronInput] = useState(value);

  const cronInputDisplay = mode === "cron" ? cronInput : value;

  const updateSchedule = useCallback((patch: Partial<SimpleSchedule>) => {
    const next = { ...schedule, ...patch };
    onChange(buildCron(next));
  }, [schedule, onChange]);

  const handleModeChange = (newMode: "simple" | "cron") => {
    setMode(newMode);
    if (newMode === "simple") {
      const result = parseCron(cronInput);
      if (result.mode === "simple") {
        onChange(buildCron(result.schedule));
      } else {
        const def: SimpleSchedule = { frequency: "daily", minute: 0, hour: 0, dayOfWeek: 0, dayOfMonth: 1 };
        onChange(buildCron(def));
      }
    } else {
      setCronInput(value);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Mode toggle header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4" />
          <span>{mode === "simple" ? describeSchedule(schedule, formatTime, schedulerTimezone) : `Cron: ${value}`}</span>
        </div>
        {/* The segmented switch of the dashboard, not two buttons of its own. */}
        <Tabs value={mode} onValueChange={(next) => handleModeChange(next as "simple" | "cron")}>
          <TabsList className="h-8">
            <TabsTrigger value="simple" className="px-2.5 text-xs">
              <Clock className="size-3" />
              Simple
            </TabsTrigger>
            <TabsTrigger value="cron" className="px-2.5 text-xs">
              <Terminal className="size-3" />
              Cron
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="p-4">
        {mode === "simple" ? (
          <div className="space-y-3">
            {/* Frequency pills */}
            <div className="flex gap-1.5">
              {FREQUENCY_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  variant={schedule.frequency === opt.value ? "default" : "outline"}
                  size="sm"
                  className="h-8 flex-1 text-xs"
                  onClick={() => updateSchedule({ frequency: opt.value })}
                >
                  {opt.label}
                </Button>
              ))}
            </div>

            {/* Time configuration - horizontal flow */}
            <div className="flex items-center gap-2 flex-wrap">
              {schedule.frequency === "weekly" && (
                <>
                  <span className="text-sm text-muted-foreground">on</span>
                  <Select value={String(schedule.dayOfWeek)} onValueChange={(v) => updateSchedule({ dayOfWeek: Number(v) })}>
                    <SelectTrigger className="w-32 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_WEEK.map((d) => (
                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}

              {schedule.frequency === "monthly" && (
                <>
                  <span className="text-sm text-muted-foreground">on day</span>
                  <Select value={String(schedule.dayOfMonth)} onValueChange={(v) => updateSchedule({ dayOfMonth: Number(v) })}>
                    <SelectTrigger className="w-20 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_MONTH.map((d) => (
                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}

              <span className="text-sm text-muted-foreground">
                {schedule.frequency === "hourly" ? "at minute" : "at"}
              </span>

              {schedule.frequency !== "hourly" && (
                <>
                  <Select value={String(schedule.hour)} onValueChange={(v) => updateSchedule({ hour: Number(v) })}>
                    <SelectTrigger className="w-20 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOURS.map((h) => (
                        <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-sm font-medium">:</span>
                </>
              )}

              <Select value={String(schedule.minute)} onValueChange={(v) => updateSchedule({ minute: Number(v) })}>
                <SelectTrigger className="w-20 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MINUTES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              placeholder="0 0 * * *"
              value={cronInputDisplay}
              onChange={(e) => {
                setCronInput(e.target.value);
                onChange(e.target.value);
              }}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Format: Minute (0-59) Hour (0-23) Day (1-31) Month (1-12) Weekday (0-6, Sun=0)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
