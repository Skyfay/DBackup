"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { TrafficLights } from "@/components/site/traffic-lights";
import { cn } from "@/lib/utils";

export function TerminalSnippet({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card font-mono text-sm",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <TrafficLights />
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
