"use client";

import { useState } from "react";
import { Plus, Star, Tag, type LucideIcon } from "lucide-react";
import { CATEGORY_ICON } from "@/components/site/roadmap/category";
import {
  GroupHeader,
  IdeaRow,
  MonthHeader,
  PlannedCard,
  ShippedEntry,
} from "@/components/site/roadmap/timeline-entries";
import { GITHUB_URL } from "@/lib/content";
import {
  ROADMAP_CATEGORIES,
  ROADMAP_ITEMS,
  SHIPPED_ITEMS,
  type RoadmapCategory,
  type ShippedItem,
} from "@/lib/roadmap";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";

type Kind = "all" | "release" | "community";

function Chip({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-[11px] text-[13px] font-medium transition-all duration-200",
        active
          ? "border-[#d4d4d8] bg-card text-foreground dark:border-[#3f3f46] dark:bg-muted"
          : "border-border bg-surface/60 text-muted-foreground hover:text-foreground"
      )}
    >
      {Icon && <Icon className="size-[13px]" />}
      {label}
      <span className="font-normal text-faint tabular-nums">{count}</span>
    </button>
  );
}

function monthsOf(items: ShippedItem[], monthLabels: Record<string, string>) {
  const months: { key: string; label: string; items: ShippedItem[] }[] = [];
  for (const item of items) {
    const key = item.releaseDate.slice(0, 7);
    let month = months[months.length - 1];
    if (!month || month.key !== key) {
      const label = monthLabels[key];
      month = { key, label, items: [] };
      months.push(month);
    }
    month.items.push(item);
  }
  return months;
}

/**
 * One spine through the roadmap: shipped work runs down the left, newest first,
 * and planned work then ideas run down the right. On a phone the two sides
 * stack, the plans first.
 */
/** The dates come written from the server, see RoadmapPage. */
export function RoadmapTimeline({
  dateLabels,
  monthLabels,
}: {
  dateLabels: Record<string, string>;
  monthLabels: Record<string, string>;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>("all");
  const [cat, setCat] = useState<RoadmapCategory | "all">("all");
  const [open, setOpen] = useState<string | null>(null);

  const isStar = (s: ShippedItem) => s.stars !== undefined;
  const latestRelease = SHIPPED_ITEMS.find((s) => !isStar(s))?.slug;
  const releases = SHIPPED_ITEMS.filter((s) => !isStar(s)).length;
  const shipped = SHIPPED_ITEMS.filter((s) => kind === "all" || (kind === "community" ? isStar(s) : !isStar(s)));
  const months = monthsOf(shipped, monthLabels);

  const visible = ROADMAP_ITEMS.filter((i) => cat === "all" || i.category === cat);
  const planned = visible.filter((i) => i.status === "planned");
  const ideas = visible.filter((i) => i.status === "idea");
  const category = cat === "all" ? null : t(`roadmap.category.${cat}`);

  return (
    <section aria-label={t("roadmap.timeline")} className="relative z-[2] mx-auto max-w-[1248px] px-6">
      {/* One column of minmax(0, 1fr) on small screens. An automatic column grows to the full
          length of a truncated description, which pushed the cards past the screen. */}
      <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 -ml-px hidden w-0.5 overflow-hidden lg:block">
          <span
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(color-mix(in srgb, var(--tone-blue-soft) 40%, transparent), color-mix(in srgb, var(--tone-blue-soft) 70%, transparent) 12%, color-mix(in srgb, var(--tone-violet) 35%, transparent) 40%, var(--border) 80%, transparent)",
            }}
          />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 -ml-[3px] hidden w-1.5 overflow-hidden lg:block">
          <span className="fx-fall absolute top-[200px] left-0 h-[70px] w-1.5 rounded-full bg-gradient-to-b from-transparent to-tone-blue-soft shadow-[0_0_12px_rgb(147_197_253/0.7)]" />
          <span
            className="fx-fall absolute top-[200px] left-0 h-[70px] w-1.5 rounded-full bg-gradient-to-b from-transparent to-tone-violet shadow-[0_0_12px_rgb(167_139_250/0.7)]"
            style={{ animationDelay: "-3.5s" }}
          />
        </div>

        <div className="order-3 flex flex-col gap-2.5 pt-14 pb-7 lg:order-none lg:items-end lg:justify-end lg:pt-[52px] lg:text-right">
          <span className="text-xs font-semibold tracking-[0.08em] text-tone-green uppercase">{t("roadmap.lookingBack")}</span>
          <h2 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]">{t("roadmap.shippedTitle")}</h2>
          <p className="max-w-[400px] leading-[1.55] text-muted-foreground">{t("roadmap.shippedLead")}</p>
          <div role="group" aria-label={t("roadmap.filterShipped")} className="mt-1 flex flex-wrap gap-1.5 lg:justify-end">
            <Chip active={kind === "all"} onClick={() => setKind("all")} label={t("roadmap.all")} count={SHIPPED_ITEMS.length} />
            <Chip active={kind === "release"} onClick={() => setKind("release")} icon={Tag} label={t("roadmap.releases")} count={releases} />
            <Chip
              active={kind === "community"}
              onClick={() => setKind("community")}
              icon={Star}
              label={t("roadmap.community")}
              count={SHIPPED_ITEMS.length - releases}
            />
          </div>
        </div>

        <div aria-hidden="true" className="hidden lg:block" />

        <div className="order-1 flex flex-col gap-2.5 pt-14 pb-7 lg:order-none lg:justify-end lg:pt-[52px]">
          <span className="text-xs font-semibold tracking-[0.08em] text-tone-violet uppercase">{t("roadmap.lookingAhead")}</span>
          <h2 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]">{t("roadmap.upNext")}</h2>
          <p className="max-w-[440px] leading-[1.55] text-muted-foreground">{t("roadmap.upNextLead")}</p>
          <div role="group" aria-label={t("roadmap.filterCategory")} className="mt-1 flex flex-wrap gap-1.5">
            <Chip active={cat === "all"} onClick={() => setCat("all")} label={t("roadmap.all")} count={ROADMAP_ITEMS.length} />
            {ROADMAP_CATEGORIES.map((c) => (
              <Chip
                key={c}
                active={cat === c}
                onClick={() => {
                  setCat(c);
                  setOpen(null);
                }}
                icon={CATEGORY_ICON[c]}
                label={t(`roadmap.category.${c}`)}
                count={ROADMAP_ITEMS.filter((i) => i.category === c).length}
              />
            ))}
          </div>
        </div>

        <div className="order-4 flex flex-col gap-1.5 pb-6 lg:order-none">
          {months.map((m) => (
            <div key={m.key} className="flex flex-col gap-1.5">
              <MonthHeader label={m.label} />
              {m.items.map((item) => (
                <ShippedEntry key={item.slug} item={item} dateLabel={dateLabels[item.slug]} latest={item.slug === latestRelease} />
              ))}
            </div>
          ))}
          {months.length === 0 && <p className="px-4 py-[18px] text-faint lg:text-right">{t("roadmap.nothingMatches")}</p>}
        </div>

        <div aria-hidden="true" className="hidden lg:block" />

        <div className="order-2 flex flex-col gap-2.5 pb-6 lg:order-none">
          <GroupHeader label={t("roadmap.next")} sub={t("roadmap.planned")} count={planned.length} tone="violet" />
          {planned.map((item) => (
            <PlannedCard key={item.slug} item={item} />
          ))}
          {planned.length === 0 && (
            <p className="rounded-[14px] border border-dashed border-border-strong px-4 py-3.5 text-faint">
              {category ? t("roadmap.noPlannedIn", { category }) : t("roadmap.noPlanned")}
            </p>
          )}

          <div className="pt-2">
            <GroupHeader
              label={t("roadmap.later")}
              sub={t("roadmap.ideas")}
              count={ideas.length}
              tone="amber"
              note={t("roadmap.clickForNote")}
            />
          </div>
          {ideas.map((item) => (
            <IdeaRow
              key={item.slug}
              item={item}
              expanded={open === item.slug}
              onToggle={() => setOpen(open === item.slug ? null : item.slug)}
            />
          ))}
          {ideas.length === 0 && (
            <p className="rounded-[14px] border border-dashed border-border-strong px-4 py-3.5 text-faint">
              {category ? t("roadmap.noIdeasIn", { category }) : t("roadmap.noIdeas")}
            </p>
          )}
          <a
            href={`${GITHUB_URL}/issues/new`}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 flex h-[34px] w-fit items-center gap-1.5 rounded-lg border border-input bg-secondary px-3 text-[13px] font-medium"
          >
            <Plus className="size-[13px]" strokeWidth={2.4} />
            {t("roadmap.suggest")}
          </a>
        </div>
      </div>
    </section>
  );
}
