"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { CONIC, SpinBorder } from "@/components/site/fx";
import { RunDiagram } from "@/components/site/home/run-diagram";
import { useReducedMotion, useTick } from "@/components/site/home/use-tick";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";

// A backup run played on a loop: six steps of 14 ticks each, then 22 ticks
// finished, then it starts over. One tick is 120 ms.
const STEP = 14;
const CYCLE = STEP * 6 + 22;

// The steps are words of the app and follow the language, the log lines stay
// as the tools print them.
const STEPS: { text: MessageKey; meta: string | { key: MessageKey; vars: Record<string, string | number> } }[] = [
  { text: "liveRun.stepDump", meta: "412 MB" },
  { text: "liveRun.stepCollect", meta: { key: "liveRun.files", vars: { count: 2318 } } },
  { text: "liveRun.stepCompress", meta: "188 MB" },
  { text: "liveRun.stepEncrypt", meta: { key: "liveRun.key", vars: { id: "7f3a" } } },
  { text: "liveRun.stepUploadHetzner", meta: "fsn1" },
  { text: "liveRun.stepUploadR2", meta: "auto" },
];

const LOGS: [string, string][] = [
  ["mariadb-dump", "Dumping nextcloud with single transaction"],
  ["mariadb-dump", "Wrote 412 MB in 38 s"],
  ["sftp", "Walking /srv/nextcloud/config and /data"],
  ["sftp", "Collected 2,318 files, 1,904 unchanged"],
  ["brotli", "Compressing at level 6"],
  ["brotli", "Archive is 188 MB, 46 % of the source"],
  ["crypto", "Encrypting stream with AES-256-GCM"],
  ["crypto", "Auth tag written, manifest signed"],
  ["upload", "Uploading to Hetzner Object Storage"],
  ["upload", "Hetzner copy verified"],
  ["upload", "Uploading to Cloudflare R2"],
  ["upload", "R2 copy verified"],
];

const TAG_TONE: Record<string, string> = {
  "mariadb-dump": "text-tone-blue",
  sftp: "text-tone-cyan",
  brotli: "text-tone-violet",
  crypto: "text-tone-green",
  upload: "text-tone-amber",
  done: "text-tone-green",
};

const pad = (n: number) => String(n).padStart(2, "0");

export function LiveRun() {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const tick = useTick(120, ref, 400);
  const reduced = useReducedMotion();
  const [tilt, setTilt] = useState<{ rx: number; ry: number } | null>(null);

  const ct = tick % CYCLE;
  const cur = Math.min(Math.floor(ct / STEP), STEPS.length);
  const within = (ct % STEP) / STEP;
  const finished = cur >= STEPS.length;
  const pct = finished ? 100 : Math.round(((cur + within) / STEPS.length) * 100);

  const shown = Math.min(cur * 2 + (within > 0.5 ? 2 : within > 0.1 ? 1 : 0), LOGS.length);
  const lines = LOGS.slice(0, shown);
  if (finished) lines.push(["done", "Finished in 4 min 12 s, 2 copies verified"]);
  const logs = lines.slice(-5).map(([tag, text], i, arr) => {
    const sec = 7200 + (shown - arr.length + i) * 21;
    const time = `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
    return { key: shown - arr.length + i, tag, text, time };
  });

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTilt({
      rx: -((e.clientY - r.top) / r.height - 0.5) * 6,
      ry: ((e.clientX - r.left) / r.width - 0.5) * 8,
    });
  }

  return (
    <div ref={ref} className="relative z-[2] mx-auto mt-[72px] max-w-[1248px] px-6">
      <div
        onMouseMove={onMove}
        onMouseLeave={() => setTilt(null)}
        className="transition-transform duration-[250ms] ease-out"
        style={{
          transform: `perspective(1600px) rotateX(${(tilt?.rx ?? 0).toFixed(2)}deg) rotateY(${(tilt?.ry ?? 0).toFixed(2)}deg)`,
        }}
      >
        <SpinBorder
          conic={CONIC.hero}
          size={2000}
          radius={22}
          className="shadow-[var(--hero-shadow)]"
          innerClassName="grid bg-card xl:min-h-[540px] xl:grid-cols-[540px_1fr]"
        >
          <div className="flex min-w-0 flex-col gap-4 p-6">
            <div className="flex items-start gap-3">
              <div className="min-w-0 grow text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">Nextcloud nightly</span>
                  <span className="rounded-full border border-input px-2 py-0.5 text-xs font-medium text-subtle">
                    {t("liveRun.incremental")}
                  </span>
                </div>
                <div className="text-[13px] text-muted-foreground">{t("liveRun.jobDetail")}</div>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                  finished ? "bg-tone-green/12 text-tone-green" : "bg-tone-blue/12 text-tone-blue"
                )}
              >
                <span className="relative size-1.5">
                  {!finished && <span className="fx-ping absolute inset-0 rounded-full bg-current" />}
                  <span className="absolute inset-0 rounded-full bg-current" />
                </span>
                {finished ? t("liveRun.completed") : t("liveRun.running")}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{finished ? t("liveRun.finished") : t(STEPS[cur].text)}</span>
                <span>{pct} %</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-150 ease-linear",
                    finished
                      ? "bg-tone-green shadow-[0_0_12px_rgb(52_211_153/0.6)]"
                      : "bg-gradient-to-r from-[#2563eb] to-tone-blue shadow-[0_0_12px_rgb(96_165_250/0.6)]"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            <ol className="flex flex-col">
              {STEPS.map((s, i) => {
                const done = i < cur;
                const now = i === cur && !finished;
                return (
                  <li
                    key={s.text}
                    className={cn(
                      "flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-[13px] transition-colors duration-200",
                      now && "bg-tone-blue/8"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full",
                        done && "bg-tone-green",
                        now && "bg-tone-blue shadow-[0_0_0_4px_rgb(96_165_250/0.18),0_0_16px_rgb(96_165_250/0.6)]",
                        !done && !now && "border-2 border-input"
                      )}
                    >
                      {done && <Check className="size-[11px] text-tone-ink" strokeWidth={3.2} />}
                      {now && (
                        <span className="fx-spin size-3 rounded-full border-2 border-tone-ink/25 border-t-tone-ink" />
                      )}
                    </span>
                    <span
                      className={cn(
                        "text-left font-medium",
                        done ? "text-subtle" : now ? "text-tone-blue-soft" : "text-fainter"
                      )}
                    >
                      {t(s.text)}
                    </span>
                    <span className="ml-auto text-xs text-faint tabular-nums">
                      {done ? (typeof s.meta === "string" ? s.meta : t(s.meta.key, s.meta.vars)) : now ? `${Math.round(within * 100)} %` : ""}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div
              aria-hidden="true"
              className="mt-auto min-h-28 rounded-xl border border-border bg-background px-3.5 py-3 text-left font-mono text-xs leading-[1.8]"
            >
              {logs.map((l) => (
                <div key={l.key} className="fx-in flex gap-2.5 overflow-hidden whitespace-nowrap">
                  <span className="text-fainter">{l.time}</span>
                  <span className={TAG_TONE[l.tag]}>{l.tag}</span>
                  <span className="truncate text-subtle">{l.text}</span>
                </div>
              ))}
            </div>
          </div>

          <RunDiagram cur={cur} finished={finished} />
        </SpinBorder>
      </div>
    </div>
  );
}
