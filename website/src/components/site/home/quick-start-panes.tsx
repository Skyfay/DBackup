import Image from "next/image";
import { Check, ChevronLeft, ChevronRight, KeyRound, Lock, RefreshCw } from "lucide-react";
import {
  COMPOSE_SECRET_LINES,
  TOKEN_CLASS,
  continuesOnNextLine,
  shortenSecret,
  type CodeLine,
} from "@/components/site/home/code-tokens";
import { cn } from "@/lib/utils";

// The panes inside the editor window of the quick start. Each one draws a
// moment of the install from `stage` (0 to 2) and `local`, the ticks spent in
// that stage so far.

function Cursor() {
  return <span className="fx-blink ml-0.5 inline-block h-[15px] w-2 bg-[#d4d4d8] align-[-3px]" />;
}

/** The first `budget` characters of a line as shown, still highlighted. */
function visibleTokens(line: CodeLine, budget: number): CodeLine {
  const out: CodeLine = [];
  let left = budget;
  for (const [full, kind] of line) {
    const text = kind === "secret" ? shortenSecret(full) : full;
    if (left <= 0) break;
    out.push([text.slice(0, left), kind]);
    left -= text.length;
  }
  return out;
}

function Tokens({ line, budget = Infinity }: { line: CodeLine; budget?: number }) {
  return (
    <>
      {visibleTokens(line, budget).map(([text, kind], i) => (
        <span key={i} className={TOKEN_CLASS[kind]}>
          {text}
        </span>
      ))}
    </>
  );
}

const lineLength = (line: CodeLine) =>
  line.reduce((n, [text, kind]) => n + (kind === "secret" ? shortenSecret(text) : text).length, 0);

/**
 * The compose file, its two secret lines marked while the first step runs,
 * with a box that fills them in with keys made in the browser.
 */
export function EditorPane({
  stage,
  lines,
  generated,
  onGenerate,
}: {
  stage: number;
  lines: CodeLine[];
  generated: boolean;
  onGenerate: () => void;
}) {
  const marked = stage === 0;
  return (
    <div
      className={cn(
        "absolute inset-0 transition-[opacity,filter] duration-400",
        !marked && "opacity-35 blur-[0.5px]"
      )}
    >
      <div className="absolute inset-0 overflow-auto pt-3.5 pb-28 font-mono text-[13px] leading-[26px] sm:pb-3.5">
        <div aria-hidden="true" className="absolute inset-y-0 left-0 w-[52px] border-r border-[#1a1a1c] bg-[#0b0b0d]" />
        {lines.map((line, i) => {
          const hot = marked && COMPOSE_SECRET_LINES.includes(i);
          return (
            <div
              key={i}
              className={cn(
                "relative flex h-[26px] min-w-max items-center transition-colors duration-300 hover:bg-white/[0.03]",
                hot &&
                  (generated
                    ? "bg-[linear-gradient(90deg,rgb(52_211_153/0.09),rgb(52_211_153/0.02)_70%,transparent)]"
                    : "bg-[linear-gradient(90deg,rgb(251_191_36/0.09),rgb(251_191_36/0.02)_70%,transparent)]")
              )}
            >
              {hot && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-y-0 left-0 w-0.5",
                    generated ? "bg-[#34d399] shadow-[0_0_8px_#34d399]" : "bg-[#fbbf24] shadow-[0_0_8px_#fbbf24]"
                  )}
                />
              )}
              <span aria-hidden="true" className="relative w-[52px] shrink-0 pr-3.5 text-right text-[#3f3f46] select-none">
                {i + 1}
              </span>
              <span key={generated ? "keys" : "plain"} className={cn("pl-[18px] whitespace-pre", hot && generated && "fx-in")}>
                <Tokens line={line} />
              </span>
            </div>
          );
        })}
      </div>

      {marked && (
        <div
          className={cn(
            "fx-in absolute right-3 bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-[#111113]/95 px-3 py-2 shadow-[0_16px_30px_-12px_rgb(0_0_0/0.9)] backdrop-blur sm:left-auto",
            generated ? "border-[#34d399]/30" : "border-[#fbbf24]/30"
          )}
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg",
              generated ? "bg-[#34d399]/14 text-[#34d399]" : "bg-[#fbbf24]/14 text-[#fbbf24]"
            )}
          >
            {generated ? <Check className="size-3.5" strokeWidth={2.6} /> : <KeyRound className="size-3.5" />}
          </span>
          <span className="flex grow flex-col leading-tight">
            <span className="text-[13px] font-medium text-[#fafafa]">
              {generated ? "Keys made in your browser" : "Two secrets to fill in"}
            </span>
            <span className="text-xs text-[#a1a1aa]">
              {generated ? "Copy takes them in full. Nothing was sent anywhere." : "Make them here, or with openssl as the comments say."}
            </span>
          </span>
          <button
            type="button"
            onClick={onGenerate}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-[transform,box-shadow] duration-150 hover:-translate-y-px",
              generated
                ? "border border-[#313137] bg-[#313137]/30 text-[#fafafa]"
                : "bg-[#fbbf24] text-[#0a0a0b] shadow-[0_0_20px_rgb(251_191_36/0.35)]"
            )}
          >
            {generated ? <RefreshCw className="size-3.5" /> : <KeyRound className="size-3.5" />}
            {generated ? "New keys" : "Generate keys"}
          </button>
        </div>
      )}
    </div>
  );
}

const COMPOSE_COMMAND = "docker compose up -d";
const COMPOSE_OUTPUT: CodeLine[] = [
  [["[+] Running 2/2", "punct"]],
  [[" Network ", "punct"], ["dbackup_default", "value"], ["   Created", "string"]],
  [[" Container ", "punct"], ["dbackup", "value"], ["           Started", "string"]],
];

/** A terminal that slides up under the file and starts the container. */
export function DockTerminal({ stage, local }: { stage: number; local: number }) {
  const typed = stage === 1 ? Math.min(COMPOSE_COMMAND.length, Math.max(0, local - 3)) : stage > 1 ? COMPOSE_COMMAND.length : 0;
  const done = typed === COMPOSE_COMMAND.length;
  const shown =
    stage > 1 ? COMPOSE_OUTPUT.length : done ? Math.min(COMPOSE_OUTPUT.length, Math.floor((local - 3 - COMPOSE_COMMAND.length) / 4) + 1) : 0;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute inset-x-0 bottom-0 h-[196px] border-t border-[#2a2a2e] bg-[#0b0b0d] shadow-[0_-20px_40px_-20px_rgb(0_0_0/0.9)] transition-transform duration-[450ms] ease-[cubic-bezier(.2,.8,.2,1)]",
        stage >= 1 ? "translate-y-0" : "translate-y-full"
      )}
    >
      <div className="flex h-[34px] items-center gap-4 border-b border-[#1a1a1c] px-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
        <span className="flex h-full items-center text-[#fafafa] shadow-[inset_0_-2px_0_#a78bfa]">Terminal</span>
        <span className="text-[#52525b]">Output</span>
        <span className="ml-auto font-mono text-[11px] font-normal tracking-normal text-[#52525b] normal-case">
          zsh · ~/dbackup
        </span>
      </div>
      <div className="overflow-x-auto px-[18px] py-3 font-mono text-[13px] leading-6 whitespace-pre">
        <div>
          <span className="text-[#60a5fa]">~/dbackup $ </span>
          <span className="text-[#e4e4e7]">{COMPOSE_COMMAND.slice(0, typed)}</span>
          {stage === 1 && !done && <Cursor />}
        </div>
        {COMPOSE_OUTPUT.slice(0, shown).map((line, i) => (
          <div key={i} className="fx-in">
            <Tokens line={line} />
          </div>
        ))}
        {shown === COMPOSE_OUTPUT.length && (
          <div>
            <span className="text-[#60a5fa]">~/dbackup $ </span>
            <Cursor />
          </div>
        )}
      </div>
    </div>
  );
}

const RUN_OUTPUT: CodeLine[] = [
  [["Unable to find image 'skyfay/dbackup:latest' locally", "punct"]],
  [["latest: Pulling from skyfay/dbackup", "punct"]],
  [["Status: ", "punct"], ["Downloaded", "string"], [" newer image for skyfay/dbackup:latest", "punct"]],
  [["7f3a9c2e41b8d6f05e13a7c9b2d4e8f1a6c3b5d7e9f0a2b4c6d8e0f1a3b5c7d9", "value"]],
];

/** The second terminal: the commands are pasted, then Docker answers. */
export function RunTerminal({ stage, local, lines: source }: { stage: number; local: number; lines: CodeLine[] }) {
  let budget = stage === 0 ? local * 8 : Infinity;
  const lines: { line: CodeLine; budget: number }[] = [];
  for (const line of source) {
    if (budget <= 0) break;
    lines.push({ line, budget });
    budget -= lineLength(line);
  }
  const pasting = budget <= 0;
  const shown = stage === 0 ? 0 : stage > 1 ? RUN_OUTPUT.length : Math.min(RUN_OUTPUT.length, Math.floor(local / 6) + 1);

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-x-auto px-4 py-4 font-mono text-[13px] leading-6 whitespace-pre">
      {lines.map(({ line, budget: b }, i) => (
        <div key={i}>
          {(i === 0 || !continuesOnNextLine(source[i - 1])) && <span className="text-[#60a5fa]">~ $ </span>}
          <Tokens line={line} budget={b} />
          {pasting && i === lines.length - 1 && <Cursor />}
        </div>
      ))}
      {RUN_OUTPUT.slice(0, shown).map((line, i) => (
        <div key={`out-${i}`} className="fx-in">
          <Tokens line={line} />
        </div>
      ))}
      {shown === RUN_OUTPUT.length && (
        <div>
          <span className="text-[#60a5fa]">~ $ </span>
          <Cursor />
        </div>
      )}
    </div>
  );
}

const PARTS = [
  { label: "Source", value: "PostgreSQL · prod-db", tag: "Answering" },
  { label: "Destination", value: "Hetzner Object Storage", tag: "2 TB free" },
  { label: "Schedule", value: "Every day at 02:00", tag: "GFS 7 · 4 · 12" },
];

/** A browser on localhost:3000 where Quick Setup fills in, the last step of both tabs. */
export function SetupBrowser({ stage, local }: { stage: number; local: number }) {
  const visible = stage === 2;
  const filled = visible ? Math.min(PARTS.length, Math.floor(Math.max(0, local - 6) / 9)) : 0;
  const ready = filled === PARTS.length;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute inset-0 bg-[#0d0d0f] transition-[transform,opacity] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]",
        visible ? "opacity-100" : "pointer-events-none translate-y-6 scale-[0.98] opacity-0"
      )}
    >
      <div className="flex h-10 items-center gap-2.5 border-b border-[#232326] bg-[#111113] px-3">
        <span className="flex gap-1.5 text-[#52525b]">
          <ChevronLeft className="size-3.5" />
          <ChevronRight className="size-3.5" />
        </span>
        <span className="flex h-[26px] min-w-0 grow items-center gap-1.5 rounded-[7px] border border-[#232326] bg-[#0d0d0f] px-2.5 font-mono text-xs text-[#a1a1aa]">
          <Lock className="size-3 shrink-0 text-[#34d399]" />
          <span className="text-[#e4e4e7]">localhost:3000</span>/setup
        </span>
        <Image src="/logo.svg" alt="" width={20} height={20} />
      </div>
      <div className="flex flex-col gap-2.5 px-[22px] py-5">
        <div className="mb-0.5 flex items-center justify-between">
          <span className="text-base font-semibold">Quick Setup</span>
          <span className="text-xs text-[#a1a1aa]">{filled} of 3 parts</span>
        </div>
        {PARTS.map((p, i) => {
          const done = i < filled;
          return (
            <div
              key={p.label}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3.5 py-[11px] transition-all duration-300",
                done && "border border-[#2a2a2e] bg-[#141416]",
                !done && i === filled && "border border-dashed border-[#34d399]/50 bg-[#34d399]/[0.04]",
                !done && i !== filled && "border border-dashed border-[#2a2a2e] opacity-60"
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full",
                  done ? "bg-[#34d399]" : "border-2 border-[#313137]"
                )}
              >
                {done && <Check className="size-[11px] text-[#0a0a0b]" strokeWidth={3.2} />}
              </span>
              <div className="grow">
                <div className="text-xs text-[#71717a]">{p.label}</div>
                <div className="font-medium">{done ? p.value : "Pick one"}</div>
              </div>
              {done && (
                <span className="rounded-full bg-[#34d399]/12 px-2 py-0.5 text-xs font-medium text-[#34d399]">{p.tag}</span>
              )}
            </div>
          );
        })}
        <div className="mt-1 flex justify-end">
          <span
            className={cn(
              "flex h-9 items-center rounded-lg px-4 font-medium transition-all duration-300",
              ready ? "bg-[#60a5fa] text-[#0a0a0b] shadow-[0_0_20px_rgb(96_165_250/0.45)]" : "bg-[#252528] text-[#71717a]"
            )}
          >
            Create job
          </span>
        </div>
      </div>
    </div>
  );
}
