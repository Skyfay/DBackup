"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";

export function CodeBlock({
  className,
  children,
  ...props
}: React.ComponentProps<"pre">) {
  const { t } = useI18n();
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = preRef.current?.textContent ?? "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative mb-[22px]">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-md border border-input bg-surface-2 px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? t("blog.copied") : t("blog.copy")}
      </button>
      <pre
        ref={preRef}
        className={cn(
          "code-highlight overflow-x-auto rounded-2xl border border-border bg-surface px-5 py-4 font-mono text-[13px] leading-[1.75]",
          className
        )}
        {...props}
      >
        {children}
      </pre>
    </div>
  );
}
