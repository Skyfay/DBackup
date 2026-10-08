"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { CONIC, Eyebrow, Glow, SpinBorder } from "@/components/site/fx";
import { useReducedMotion, useTick } from "@/components/site/home/use-tick";
import { codeText, composeLines, generateKeys, runLines, type Keys } from "@/components/site/home/code-tokens";
import { DockTerminal, EditorPane, RunTerminal, SetupBrowser } from "@/components/site/home/quick-start-panes";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";

// Each step plays for 50 ticks of 120 ms, then the next one starts, until a
// step is picked. Switching the tab starts over at step 1.
const STEP = 50;

const TONES = [
  { color: "#60a5fa", rgb: "96 165 250" },
  { color: "#a78bfa", rgb: "167 139 250" },
  { color: "#34d399", rgb: "52 211 153" },
];

type Step = { title: MessageKey; text: MessageKey; status: MessageKey };

const TABS = {
  compose: {
    file: "docker-compose.yml",
    badge: "YML",
    tone: TONES[0],
    lang: "YAML · zsh",
    lines: composeLines,
    steps: [
      { title: "start.saveCompose", text: "start.saveComposeText", status: "start.saveComposeStatus" },
      { title: "start.startContainer", text: "start.startComposeText", status: "start.startComposeStatus" },
      { title: "start.followSetup", text: "start.followSetupText", status: "start.followSetupStatus" },
    ] as Step[],
  },
  run: {
    file: "docker run",
    badge: "$_",
    tone: TONES[1],
    lang: "Shell",
    lines: runLines,
    steps: [
      { title: "start.copyCommands", text: "start.copyCommandsText", status: "start.copyCommandsStatus" },
      { title: "start.startContainer", text: "start.startRunText", status: "start.startRunStatus" },
      { title: "start.followSetup", text: "start.followSetupText", status: "start.followSetupStatus" },
    ] as Step[],
  },
};
type TabId = keyof typeof TABS;

export function QuickStart() {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const tick = useTick(120, ref, 0);
  const reduced = useReducedMotion();
  const [tab, setTab] = useState<TabId>("compose");
  const [start, setStart] = useState(0);
  const [picked, setPicked] = useState<{ step: number; at: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [keys, setKeys] = useState<Keys | null>(null);
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // With reduced motion nothing plays: a step shows its finished state and
  // only changes when picked.
  // While the mouse is on the window the steps hold still, so the box to
  // generate keys can be reached before the next step takes over.
  const now = hoverAt ?? tick;
  const elapsed = Math.max(0, now - start);
  const stage = picked ? picked.step : reduced ? 0 : Math.floor(elapsed / STEP) % 3;
  const local = reduced ? 999 : picked ? tick - picked.at : elapsed % STEP;
  const current = TABS[tab];
  const lines = current.lines(keys);
  const code = codeText(lines);

  function generate() {
    setKeys(generateKeys());
    setPicked({ step: 0, at: tick - STEP });
  }
  const progress = (i: number) => (i < stage ? 100 : i > stage ? 0 : picked || reduced ? 100 : Math.min(100, (local / STEP) * 100));

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section
      ref={ref}
      id="start"
      className="relative mx-auto grid max-w-[1248px] items-start gap-14 px-6 pt-28 sm:pt-[140px] lg:grid-cols-[5fr_7fr]"
    >
      <Glow
        color={TONES[stage].color}
        opacity={0.18}
        blur={110}
        className="top-[180px] right-[8%] h-[460px] w-[min(620px,90%)] transition-[background] duration-700"
      />

      <div className="relative flex flex-col gap-6">
        <Eyebrow>{t("start.eyebrow")}</Eyebrow>
        <h2 className="text-[34px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[48px]">{t("start.title")}</h2>
        <div role="group" aria-label={t("start.steps")} className="relative flex flex-col gap-1.5">
          <span aria-hidden="true" className="absolute top-[34px] bottom-[34px] left-[25px] w-0.5 bg-border" />
          {current.steps.map((s, i) => {
            const on = i === stage;
            const done = i < stage;
            const tone = TONES[i];
            return (
              <button
                key={s.title}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked({ step: i, at: tick })}
                className={cn(
                  "relative flex items-start gap-3.5 rounded-[14px] border p-3 text-left transition-all duration-250",
                  on ? "" : "border-transparent hover:bg-foreground/[0.03]"
                )}
                style={on ? { borderColor: `rgb(${tone.rgb} / 0.3)`, background: `rgb(${tone.rgb} / 0.06)` } : undefined}
              >
                <span
                  className={cn(
                    "relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold transition-all duration-250",
                    !on && !done && "border border-input bg-surface text-muted-foreground"
                  )}
                  style={
                    on || done
                      ? {
                          background: tone.color,
                          color: "#0a0a0b",
                          boxShadow: `0 0 0 4px rgb(${tone.rgb} / 0.18)${on ? `, 0 0 24px rgb(${tone.rgb} / 0.6)` : ""}`,
                        }
                      : undefined
                  }
                >
                  {i + 1}
                </span>
                <span className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="font-semibold">{t(s.title)}</span>
                  <span className="text-muted-foreground">{t(s.text)}</span>
                  <span aria-hidden="true" className="mt-2 h-0.5 overflow-hidden rounded-full bg-border">
                    <span
                      className="block h-full rounded-full transition-[width] duration-150 ease-linear"
                      style={{ width: `${progress(i)}%`, background: tone.color }}
                    />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="min-w-0"
        onMouseEnter={() => setHoverAt(tick)}
        onMouseLeave={() => {
          if (hoverAt !== null) setStart((s) => s + (tick - hoverAt));
          setHoverAt(null);
        }}
      >
        <SpinBorder
          conic={CONIC.blue}
          size={1800}
          speed="normal"
          radius={18}
          className="shadow-[0_50px_100px_-40px_rgb(37_99_235/0.45)]"
          innerClassName="dark overflow-hidden bg-[#0d0d0f] text-foreground"
        >
          <div className="flex h-11 items-center gap-3.5 border-b border-[#232326] bg-[#111113] pr-2 pl-3.5">
            <span aria-hidden="true" className="hidden gap-[7px] sm:flex">
              <span className="size-[11px] rounded-full bg-[#f0555a]" />
              <span className="size-[11px] rounded-full bg-[#fbbf24]" />
              <span className="size-[11px] rounded-full bg-[#34d399]" />
            </span>
            <div role="tablist" aria-label={t("start.install")} className="flex self-stretch">
              {(Object.keys(TABS) as TabId[]).map((id) => {
                const t = TABS[id];
                const on = id === tab;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => {
                      if (on) return;
                      setTab(id);
                      setStart(tick);
                      setPicked(null);
                      if (hoverAt !== null) setHoverAt(tick);
                    }}
                    className={cn(
                      "relative flex items-center gap-2 border-r border-[#232326] px-3.5 font-mono text-xs transition-colors duration-200",
                      on ? "bg-[#0d0d0f] text-[#fafafa]" : "text-[#71717a] hover:text-[#d4d4d8]"
                    )}
                  >
                    <span
                      className="rounded px-[5px] py-px text-[10px] font-semibold"
                      style={{ background: on ? `rgb(${t.tone.rgb} / 0.16)` : "#1a1a1c", color: on ? t.tone.color : "#52525b" }}
                    >
                      {t.badge}
                    </span>
                    {t.file}
                    {on && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 top-0 h-0.5"
                        style={{ background: t.tone.color, boxShadow: `0 0 10px ${t.tone.color}` }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={copy}
              className={cn(
                "ml-auto flex h-[30px] items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-all duration-200",
                copied ? "border-[#34d399]/35 bg-[#34d399]/10 text-[#34d399]" : "border-[#313137] bg-[#313137]/30 text-[#fafafa]"
              )}
            >
              {copied ? <Check className="size-3.5" strokeWidth={2.4} /> : <Copy className="size-3.5" />}
              {copied ? t("start.copied") : t("start.copy")}
            </button>
          </div>

          <div role="tabpanel" className="relative h-[420px] overflow-hidden">
            <pre className="sr-only">{code}</pre>
            {tab === "compose" ? (
              <>
                <EditorPane stage={stage} lines={lines} generated={keys !== null} onGenerate={generate} />
                <DockTerminal stage={stage} local={local} />
              </>
            ) : (
              <RunTerminal stage={stage} local={local} lines={lines} />
            )}
            <SetupBrowser stage={stage} local={local} />
          </div>

          <div className="flex h-8 items-center gap-3.5 border-t border-[#232326] bg-[#111113] px-3.5 text-xs text-[#71717a]">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-[#a1a1aa]">
              <span
                className="size-[7px] shrink-0 rounded-full"
                style={{ background: TONES[stage].color, boxShadow: `0 0 8px ${TONES[stage].color}` }}
              />
              {t("start.stepOf", { step: stage + 1, status: t(current.steps[stage].status) })}
            </span>
            <span aria-hidden="true" className="ml-auto hidden gap-1 sm:flex">
              {TONES.map((tone, i) => (
                <span key={i} className="h-1 w-[22px] overflow-hidden rounded-full bg-[#252528]">
                  <span className="block h-full rounded-full" style={{ width: `${progress(i)}%`, background: tone.color }} />
                </span>
              ))}
            </span>
            <span className="hidden sm:inline">{current.lang}</span>
          </div>
        </SpinBorder>
      </div>
    </section>
  );
}
