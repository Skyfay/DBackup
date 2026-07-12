"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { BrowserFrame } from "@/components/site/browser-frame";
import { SectionHeading } from "@/components/site/section-heading";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const SCREENSHOTS = [
  {
    id: "overview",
    label: "Overview",
    src: "/screenshots/dashboard.png",
    lightSrc: "/screenshots/dashboard-light.png",
  },
  {
    id: "sources",
    label: "Sources",
    src: "/screenshots/sources.png",
    lightSrc: "/screenshots/sources-light.png",
  },
  {
    id: "jobs",
    label: "Jobs",
    src: "/screenshots/edit-job.png",
    lightSrc: "/screenshots/edit-job-light.png",
  },
  {
    id: "storage",
    label: "Storage Explorer",
    src: "/screenshots/storage-explorer.png",
    lightSrc: "/screenshots/storage-explorer-light.png",
  },
  {
    id: "database",
    label: "Database Explorer",
    src: "/screenshots/database-explorer.png",
    lightSrc: "/screenshots/database-explorer-light.png",
  },
  {
    id: "history",
    label: "History",
    src: "/screenshots/history-live-log.png",
    lightSrc: "/screenshots/history-live-log-light.png",
  },
  {
    id: "templates",
    label: "Templates",
    src: "/screenshots/templates.png",
    lightSrc: "/screenshots/templates-light.png",
  },
  {
    id: "users",
    label: "Users & Groups",
    src: "/screenshots/user-groups.png",
    lightSrc: "/screenshots/user-groups-light.png",
  },
  {
    id: "settings",
    label: "Settings",
    src: "/screenshots/settings.png",
    lightSrc: "/screenshots/settings-light.png",
  },
  {
    id: "profile",
    label: "Profile",
    src: "/screenshots/profile.png",
    lightSrc: "/screenshots/profile-light.png",
  },
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

  return (
    <section
      ref={sectionRef}
      className="relative mx-auto hidden max-w-7xl px-6 py-24 sm:block"
    >
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
        <Tabs
          value={SCREENSHOTS[index].id}
          onValueChange={(value) => {
            const i = SCREENSHOTS.findIndex((shot) => shot.id === value);
            if (i !== -1) goTo(i);
          }}
          className="mx-auto mb-4 w-fit max-w-full"
        >
          <TabsList className="flex-wrap justify-center">
            {SCREENSHOTS.map((shot) => (
              <TabsTrigger key={shot.id} value={shot.id} aria-label={`Show ${shot.label} screenshot`}>
                {shot.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

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
                  // Scaled up slightly to mask sub-pixel rounding gaps that object-cover
                  // can leave at certain viewport widths (e.g. exactly 1920px).
                  "scale-[1.02] object-cover object-top transition-opacity duration-500 motion-reduce:transition-none",
                  i === index ? "opacity-100" : "opacity-0"
                )}
              />
            ))}
          </div>
        </BrowserFrame>
      </div>
    </section>
  );
}
