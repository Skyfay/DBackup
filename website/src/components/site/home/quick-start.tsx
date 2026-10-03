"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Eyebrow } from "@/components/site/fx";
import { SpotlightCard } from "@/components/site/spotlight-card";
import { COMPOSE_SNIPPET, DOCKER_RUN_SNIPPET } from "@/lib/content";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "compose", label: "Docker Compose", code: COMPOSE_SNIPPET },
  { id: "run", label: "docker run", code: DOCKER_RUN_SNIPPET },
];

const STEPS = [
  { title: "Save the compose file", text: "Generate both secrets with openssl.", node: "bg-tone-blue text-tone-ink shadow-[0_0_0_4px_rgb(96_165_250/0.18),0_0_24px_rgb(96_165_250/0.5)]" },
  { title: "Start the container", text: "Then open port 3000 and create the first user.", node: "bg-tone-violet text-tone-ink shadow-[0_0_0_4px_rgb(167_139_250/0.18),0_0_24px_rgb(167_139_250/0.5)]" },
  { title: "Follow Quick Setup", text: "Source, destination and schedule in one flow.", node: "border border-input bg-surface text-muted-foreground" },
];

export function QuickStart() {
  const [tab, setTab] = useState(TABS[0].id);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const code = TABS.find((t) => t.id === tab)!.code;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

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
      id="start"
      className="mx-auto grid max-w-[1248px] items-start gap-14 px-6 pt-28 sm:pt-[140px] lg:grid-cols-[5fr_7fr]"
    >
      <div className="flex flex-col gap-6">
        <Eyebrow>Quick start</Eyebrow>
        <h2 className="text-[34px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[48px]">
          Running in two minutes.
        </h2>
        <ol className="relative flex flex-col gap-[22px]">
          <span
            aria-hidden="true"
            className="absolute top-7 bottom-7 left-[13px] w-0.5"
            style={{ background: "linear-gradient(var(--tone-blue), var(--tone-violet), var(--border))" }}
          />
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative flex gap-3.5">
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", s.node)}>
                {i + 1}
              </span>
              <div>
                <div className="font-semibold">{s.title}</div>
                <div className="text-muted-foreground">{s.text}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <SpotlightCard className="rounded-[18px]">
        <div className="relative flex h-[52px] items-center justify-between border-b border-border px-2.5">
          <div role="tablist" aria-label="Install" className="inline-flex h-8 rounded-[10px] bg-muted p-[3px]">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === tab}
                onClick={() => setTab(t.id)}
                className={cn(
                  "h-full rounded-[7px] px-3 text-xs font-medium transition-colors",
                  t.id === tab ? "bg-card text-foreground shadow-sm dark:bg-foreground/12" : "text-muted-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={copy}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-medium transition-all duration-200",
              copied ? "border-tone-green/35 bg-tone-green/10 text-tone-green" : "border-transparent"
            )}
          >
            {copied && <Check className="size-3.5" strokeWidth={2.4} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre
          role="tabpanel"
          className="relative min-h-[340px] overflow-x-auto bg-background/50 px-[22px] py-[18px] font-mono text-[13px] leading-[1.75] text-[#3f3f46] dark:text-[#e4e4e7]"
        >
          {code}
        </pre>
      </SpotlightCard>
    </section>
  );
}
