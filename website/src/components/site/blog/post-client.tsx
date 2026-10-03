"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import type { Heading } from "@/lib/blog";
import { cn } from "@/lib/utils";

/** A thin bar on top of the window that fills while the article is read. */
export function ReadingProgress({ targetId }: { targetId: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight * 0.6;
      setProgress(Math.min(1, Math.max(0, -r.top / Math.max(total, 1))));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [targetId]);

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 z-50 h-[3px] bg-gradient-to-r from-tone-blue to-tone-violet shadow-[0_0_12px_rgb(96_165_250/0.8)]"
      style={{ width: `${progress * 100}%` }}
    />
  );
}

export function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "flex h-[34px] items-center gap-1.5 rounded-lg border px-3 font-medium transition-all duration-200",
        copied ? "border-tone-green/35 bg-tone-green/10 text-tone-green" : "border-input bg-secondary"
      )}
    >
      {copied ? <Check className="size-3.5" strokeWidth={2.4} /> : <Link2 className="size-3.5" />}
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}

/** The table of contents beside the article, marking the heading being read. */
export function TableOfContents({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const update = () => {
      const line = window.innerHeight * 0.3;
      let current = 0;
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top < line) current = i;
      });
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <div className="panel rounded-2xl p-4">
      <div className="px-2 pb-2.5 text-xs font-medium tracking-[0.06em] text-faint uppercase">On this page</div>
      <nav aria-label="On this page" className="relative flex flex-col gap-0.5">
        <span aria-hidden="true" className="absolute top-1 bottom-1 left-0 w-0.5 rounded-sm bg-border" />
        {headings.map((h, i) => {
          const on = i === active;
          const past = i < active;
          return (
            <a
              key={h.id}
              href={`#${h.id}`}
              aria-current={on ? "location" : undefined}
              className={cn(
                "relative flex items-center rounded-lg py-[7px] pr-2.5 pl-4 text-[13px] font-medium transition-all duration-200",
                on ? "bg-tone-blue/8 text-foreground" : past ? "text-muted-foreground" : "text-faint hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  "absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-sm transition-colors duration-200",
                  on && "bg-tone-blue shadow-[0_0_8px_var(--tone-blue)]",
                  past && "bg-input"
                )}
              />
              {h.text}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
