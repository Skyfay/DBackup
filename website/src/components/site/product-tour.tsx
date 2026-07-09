"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { AmbientGlow } from "@/components/site/ambient-glow";
import { BrowserFrame } from "@/components/site/browser-frame";
import { SectionHeading } from "@/components/site/section-heading";
import { cn } from "@/lib/utils";

// Only the overview/dashboard screenshot currently has a light-theme capture
// (docs/public/screenshots/dashboard-light-theme.png) - the rest are dark-only
// until matching light-mode captures exist for them too.
const SCREENSHOTS = [
  {
    id: "overview",
    label: "Overview",
    src: "/screenshots/overview.png",
    lightSrc: "/screenshots/dashboard-light-theme.png",
  },
  { id: "jobs", label: "Jobs", src: "/screenshots/jobs.png" },
  { id: "storage", label: "Storage Explorer", src: "/screenshots/storage-explorer.png" },
  { id: "database", label: "Database Explorer", src: "/screenshots/database-explorer.png" },
  { id: "vault", label: "Vault", src: "/screenshots/vault.png" },
  { id: "security", label: "Security", src: "/screenshots/security.png" },
];

const AUTO_ADVANCE_MS = 5000;

export function ProductTour() {
  const { resolvedTheme } = useTheme();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const sectionRef = useRef<HTMLElement | null>(null);

  const goTo = useCallback((i: number) => {
    setIndex(((i % SCREENSHOTS.length) + SCREENSHOTS.length) % SCREENSHOTS.length);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Depending on `index` here means every slide change - whether from the
  // timer tick below or a manual click via goTo() - clears and restarts this
  // interval, which is exactly "reset the timer on manual interaction" with
  // no extra state needed.
  useEffect(() => {
    if (paused || reducedMotion || !inView) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SCREENSHOTS.length);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [index, paused, reducedMotion, inView]);

  const autoAdvancing = !paused && !reducedMotion && inView;

  return (
    <section ref={sectionRef} className="relative mx-auto max-w-7xl px-6 py-24">
      <AmbientGlow className="h-[320px] opacity-60" />

      <SectionHeading
        eyebrow="Product tour"
        title="See it in action"
        description="A quick look at the dashboard, jobs, and explorers that make up the day-to-day of running DBackup."
      />

      <div
        className="relative mt-16"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaused(false);
        }}
      >
        <div className="relative z-10 mx-auto mb-4 hidden max-w-2xl items-center gap-1 rounded-full border border-border bg-card/90 px-3 py-2 shadow-lg backdrop-blur sm:flex">
          {SCREENSHOTS.map((shot, i) => (
            <button
              key={shot.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show ${shot.label} screenshot`}
              aria-current={i === index}
              className="flex-1 py-1"
            >
              <span className="block h-1 overflow-hidden rounded-full bg-border">
                <span
                  className={cn(
                    "block h-full rounded-full bg-primary",
                    i === index
                      ? autoAdvancing
                        ? "animate-tour-progress"
                        : "w-full"
                      : "w-0"
                  )}
                  style={
                    i === index
                      ? ({ "--tour-duration": `${AUTO_ADVANCE_MS}ms` } as React.CSSProperties)
                      : undefined
                  }
                />
              </span>
              <span
                className={cn(
                  "mt-1.5 block text-center text-xs transition-colors",
                  i === index ? "font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                {shot.label}
              </span>
            </button>
          ))}
        </div>

        <BrowserFrame>
          <div className="relative aspect-[2/1] overflow-hidden">
            {SCREENSHOTS.map((shot, i) => (
              <Image
                key={shot.id}
                src={resolvedTheme === "light" && shot.lightSrc ? shot.lightSrc : shot.src}
                alt={`DBackup ${shot.label} screenshot`}
                fill
                sizes="(min-width: 1024px) 1152px, 100vw"
                priority={i === 0}
                loading={i === 0 ? undefined : "eager"}
                className={cn(
                  "object-cover object-top transition-opacity duration-500 motion-reduce:transition-none",
                  i === index ? "opacity-100" : "opacity-0"
                )}
              />
            ))}
          </div>
        </BrowserFrame>

        <div
          role="group"
          aria-label="Product screenshots"
          className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:hidden"
        >
          {SCREENSHOTS.map((shot, i) => (
            <button
              key={shot.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show ${shot.label} screenshot`}
              aria-current={i === index}
              className="flex size-8 items-center justify-center"
            >
              <span
                className={cn(
                  "size-2.5 rounded-full transition-colors",
                  i === index ? "bg-primary" : "bg-muted-foreground/30"
                )}
              />
            </button>
          ))}
        </div>
        <p className="mt-1 text-center text-sm font-medium text-muted-foreground sm:hidden">
          {SCREENSHOTS[index].label}
        </p>
      </div>
    </section>
  );
}
