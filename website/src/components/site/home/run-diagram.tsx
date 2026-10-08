"use client";

import Image from "next/image";
import { Lock } from "lucide-react";
import { AdapterIcon } from "@/components/site/adapter-icon";
import { needsDarkModeBoost } from "@/lib/adapter-icons";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";

// Sources flow into DBackup on the left and out to destinations on the right.
// Everything is placed in px inside a 640 x 540 box, like the canvas board.
const SRC_Y = [110, 200, 290, 380];
const DST_Y = [150, 260, 370];
const PATHS_IN = SRC_Y.map((y) => `M164 ${y} C 215 ${y}, 205 260, 250 260`);
const PATHS_OUT = DST_Y.map((y) => `M390 260 C 435 260, 430 ${y}, 476 ${y}`);

// A product keeps its name, the files source is a word of the page.
const SOURCES: { id: string; label: string; labelKey?: MessageKey }[] = [
  { id: "mariadb", label: "MariaDB" },
  { id: "postgres", label: "PostgreSQL" },
  { id: "mongodb", label: "MongoDB" },
  { id: "smb", label: "Files", labelKey: "liveRun.filesSource" },
];
const DESTINATIONS = [
  { id: "s3-hetzner", label: "Hetzner" },
  { id: "s3-r2", label: "Cloudflare R2" },
  { id: "discord", label: "Discord" },
];
const STAGE_OF: MessageKey[] = [
  "liveRun.stageDump",
  "liveRun.stageDump",
  "liveRun.stageCompress",
  "liveRun.stageEncrypt",
  "liveRun.stageUpload",
  "liveRun.stageUpload",
  "liveRun.stageDone",
];
const STAGES: MessageKey[] = ["liveRun.stageDump", "liveRun.stageCompress", "liveRun.stageEncrypt", "liveRun.stageUpload"];

function Chip({
  id,
  label,
  x,
  y,
  width,
  state,
}: {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  state?: "ok" | "busy" | "idle";
}) {
  return (
    <div
      className="absolute flex h-11 items-center gap-2.5 rounded-xl border border-border-strong bg-surface-2 pr-3 pl-2 shadow-[0_10px_20px_-10px_rgb(0_0_0/0.2)] dark:shadow-[0_10px_20px_-10px_rgb(0_0_0/0.6)]"
      style={{ left: x, top: y - 22, width }}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
        <AdapterIcon
          adapterId={id}
          className={cn("size-4", needsDarkModeBoost(id) && "dark:brightness-200 dark:contrast-125")}
        />
      </span>
      <span className="text-[13px] font-medium">{label}</span>
      {state && (
        <span
          className={cn(
            "ml-auto size-2 shrink-0 rounded-full transition-all duration-200",
            state === "ok" && "bg-tone-green shadow-[0_0_10px_var(--tone-green)]",
            state === "busy" && "bg-tone-blue shadow-[0_0_10px_var(--tone-blue)]",
            state === "idle" && "bg-input"
          )}
        />
      )}
    </div>
  );
}

// Imported only by the live run, a client component, so it runs in the browser too.
export function RunDiagram({ cur, finished }: { cur: number; finished: boolean }) {
  const { t } = useI18n();
  const uploaded = [cur > 4, cur > 5, finished];
  const busy = [cur === 4, cur === 5, false];
  const stage = STAGE_OF[cur];

  return (
    <div
      aria-hidden="true"
      className="hidden justify-center overflow-hidden border-t border-border md:flex xl:border-t-0 xl:border-l"
    >
      <div className="relative h-[540px] w-[640px] shrink-0">
        <svg width="640" height="540" viewBox="0 0 640 540" fill="none" className="absolute inset-0">
          <g stroke="var(--border-strong)" strokeWidth="2">
            {[...PATHS_IN, ...PATHS_OUT].map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <g className="fx-dash" stroke="var(--tone-blue)" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="4 8">
            {PATHS_IN.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <g className="fx-dash" stroke="var(--tone-green)" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="4 8">
            {PATHS_OUT.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </svg>

        {PATHS_IN.map((d, i) => (
          <span
            key={d}
            className="fx-path absolute top-0 left-0 size-2 rounded-full bg-tone-blue shadow-[0_0_12px_2px_var(--tone-blue)]"
            style={{ offsetPath: `path('${d}')`, offsetRotate: "0deg", animationDelay: `${-i * 0.6}s` }}
          />
        ))}
        {PATHS_OUT.map((d, i) => (
          <span
            key={d}
            className="fx-path absolute top-0 left-0 size-2 rounded-full bg-tone-green shadow-[0_0_12px_2px_var(--tone-green)]"
            style={{ offsetPath: `path('${d}')`, offsetRotate: "0deg", animationDelay: `${-0.4 - i * 0.7}s` }}
          />
        ))}

        <div className="absolute top-7 left-6 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
          {t("liveRun.sources")}
        </div>
        <div className="absolute top-[68px] left-[476px] text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
          {t("liveRun.destinations")}
        </div>

        {SOURCES.map((s, i) => (
          <Chip key={s.id} id={s.id} label={s.labelKey ? t(s.labelKey) : s.label} x={24} y={SRC_Y[i]} width={140} />
        ))}
        {DESTINATIONS.map((d, i) => (
          <Chip
            key={d.id}
            id={d.id}
            label={d.label}
            x={476}
            y={DST_Y[i]}
            width={150}
            state={uploaded[i] ? "ok" : busy[i] ? "busy" : "idle"}
          />
        ))}

        <div className="fx-pulse absolute top-[190px] left-[250px] flex size-[140px] flex-col items-center justify-center gap-2.5 rounded-[28px] border border-input bg-gradient-to-b from-accent to-surface shadow-[inset_0_1px_0_var(--highlight)]">
          <Image src="/logo.svg" alt="" width={52} height={52} />
          <span className="text-xs font-semibold text-tone-blue-soft">{t(stage)}</span>
        </div>

        <div className="absolute top-[360px] left-[180px] flex w-[280px] justify-center gap-1">
          {STAGES.map((g) => (
            <span
              key={g}
              className={cn(
                "rounded-full border px-2 py-[3px] text-[11px] font-medium transition-all duration-200",
                stage === g
                  ? "border-tone-blue/40 bg-tone-blue/16 text-tone-blue-soft shadow-[0_0_14px_rgb(96_165_250/0.35)]"
                  : "border-border text-fainter"
              )}
            >
              {t(g)}
            </span>
          ))}
        </div>

        <div className="absolute right-6 bottom-5 left-6 flex items-center gap-2.5 rounded-xl border border-border bg-background/60 px-3 py-2.5 text-xs text-muted-foreground">
          <Lock className="size-3.5 text-tone-green" />
          {t("liveRun.pipeline")}
        </div>
      </div>
    </div>
  );
}
