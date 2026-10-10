import { SpotlightCard } from "@/components/site/spotlight-card";
import { cn } from "@/lib/utils";
import type { MessageKey, Translator } from "@/i18n/translate";

const WEEKS = 36;
const TODAY = 246;

/**
 * 36 weeks of runs drawn from a fixed seed: mostly green, a few partial,
 * two failed, today in blue and the days ahead dashed. A glow sweeps across
 * the columns by CSS, one column every 0.2 s.
 */
function buildWeeks() {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const idx = w * 7 + d;
      if (idx > TODAY) return { kind: "ahead" as const };
      if (idx === TODAY) return { kind: "today" as const };
      const r = rnd();
      if (idx === 61 || idx === 180) return { kind: "failed" as const };
      if (r < 0.05) return { kind: "partial" as const };
      return { kind: "ok" as const, alpha: 0.2 + r * 0.8 };
    })
  );
}

const WEEK_DATA = buildWeeks();

const LEGEND: { label: MessageKey; className: string }[] = [
  { label: "features.completed", className: "bg-tone-green" },
  { label: "features.partial", className: "bg-tone-amber" },
  { label: "features.failed", className: "bg-tone-red" },
];

export function CalendarCard({ className, t }: { className?: string; t: Translator }) {
  return (
    <SpotlightCard className={cn("flex flex-col gap-4 rounded-[22px] p-6", className)}>
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold tracking-[-0.02em]">{t("features.calendarTitle")}</h3>
          <p className="mt-1.5 text-muted-foreground">{t("features.calendarText")}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {LEGEND.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-[3px]", l.className)} />
              {t(l.label)}
            </span>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="relative flex justify-end gap-1 overflow-hidden">
        {WEEK_DATA.map((days, w) => (
          <div key={w} className="flex shrink-0 flex-col gap-1">
            {days.map((day, d) => (
              <span
                key={d}
                className={cn(
                  "size-4 rounded",
                  day.kind === "ahead" && "border border-dashed border-input",
                  day.kind === "today" &&
                    "bg-tone-blue shadow-[0_0_0_3px_rgb(96_165_250/0.25),0_0_14px_rgb(96_165_250/0.7)]",
                  day.kind === "failed" && "bg-tone-red",
                  day.kind === "partial" && "bg-tone-amber",
                  day.kind === "ok" && "fx-sweep"
                )}
                style={
                  day.kind === "ok"
                    ? {
                        background: `color-mix(in srgb, var(--tone-green) ${Math.round(day.alpha * 100)}%, transparent)`,
                        animationDelay: `${(w * 0.2).toFixed(1)}s`,
                      }
                    : undefined
                }
              />
            ))}
          </div>
        ))}
      </div>
    </SpotlightCard>
  );
}
