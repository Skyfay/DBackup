"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex h-[46px] items-center gap-3 rounded-[10px] border border-input bg-surface-2/70 pr-1.5 pl-4 font-mono text-[13px] text-subtle">
      <span>
        <span className="text-tone-blue select-none">$</span> {command}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy command"}
        className="flex size-[34px] items-center justify-center rounded-lg bg-muted text-subtle transition-colors hover:text-foreground"
      >
        {copied ? <Check className="size-3.5 text-tone-green" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
