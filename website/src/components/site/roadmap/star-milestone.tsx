"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { fetchWithCache } from "@/lib/github";
import { GITHUB_REPO, GITHUB_URL } from "@/lib/content";
import type { Milestone } from "@/lib/roadmap";
import { INTL_LOCALE } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";

// Shared with the stars button in the header, so both read one request.
const CACHE_KEY = "dbackup-gh-stars";
const CACHE_TTL_MS = 10 * 60 * 1000;

export type ReachedStep = { value: number; label: string };

/** The next community goal with the live star count and the goals reached before it. */
export function StarMilestone({ milestone, reached }: { milestone: Milestone; reached: ReachedStep[] }) {
  const { t, locale } = useI18n();
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWithCache<{ stargazers_count: number }>(
      CACHE_KEY,
      `https://api.github.com/repos/${GITHUB_REPO}`,
      CACHE_TTL_MS
    )
      .then((data) => {
        if (!cancelled) setStars(data.stargazers_count);
      })
      .catch(() => {
        // Without the API the count stays hidden, the goals still show.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const last = reached[reached.length - 1]?.value ?? 0;
  const fraction = stars === null ? 0 : Math.min(1, Math.max(0, (stars - last) / (milestone.target - last)));

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">
          {t(`roadmap.milestones.${milestone.slug}.title`)}
        </span>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="flex h-[30px] shrink-0 items-center rounded-lg border border-input bg-secondary px-2.5 text-xs font-medium"
        >
          {t("roadmap.starOnGithub")}
        </a>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[26px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
          {stars === null ? "…" : new Intl.NumberFormat(INTL_LOCALE[locale]).format(stars)}
        </span>
        <span className="text-faint">{t("roadmap.ofTarget", { target: milestone.target })}</span>
      </div>

      <div aria-hidden="true" className="mt-1 flex items-center">
        {reached.map((step, i) => (
          <span key={step.value} className="contents">
            {i > 0 && <span className="h-0.5 grow bg-tone-amber shadow-[0_0_8px_rgb(251_191_36/0.5)]" />}
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-tone-amber text-tone-ink">
              <Check className="size-[11px]" strokeWidth={3} />
            </span>
          </span>
        ))}
        <span className="relative h-0.5 grow">
          <span className="fx-stripes absolute inset-0" />
          <span
            className="absolute inset-y-0 left-0 bg-tone-amber shadow-[0_0_8px_rgb(251_191_36/0.5)] transition-[width] duration-700"
            style={{ width: `${fraction * 100}%` }}
          />
        </span>
        <span className="size-5 shrink-0 rounded-full border-2 border-tone-amber bg-card" />
      </div>
      <div className="flex justify-between text-xs text-faint">
        {reached.map((step) => (
          <span key={step.value}>{step.label}</span>
        ))}
        <span className="text-tone-amber">{t("roadmap.nextStep", { target: milestone.target })}</span>
      </div>
    </>
  );
}
