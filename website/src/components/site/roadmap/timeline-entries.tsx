"use client";

import { ArrowUpRight, ChevronDown, Star } from "lucide-react";
import { SpotlightCard } from "@/components/site/spotlight-card";
import { CategoryPill } from "@/components/site/roadmap/category";
import { issueHref, shippedHref, type RoadmapItem, type ShippedItem } from "@/lib/roadmap";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";

// The entries hang off the spine in the middle of the timeline: a line from
// the card to a node on the spine, 60 px beside the card. Both only show from
// lg up, where the spine is drawn.

function Connector({ side, top, rgb, lit }: { side: "left" | "right"; top: number; rgb: string; lit?: boolean }) {
  const toSpine = side === "left" ? "90deg" : "270deg";
  return (
    <span
      aria-hidden="true"
      className={cn("absolute hidden h-px w-[55px] lg:block", side === "left" ? "-right-[55px]" : "-left-[55px]")}
      style={{ top }}
    >
      <span
        className="absolute inset-0"
        style={{ background: `linear-gradient(${toSpine}, transparent, var(--border-strong))` }}
      />
      <span
        className={cn(
          "absolute inset-0 transition-opacity duration-200",
          lit ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
        style={{ background: `linear-gradient(${toSpine}, rgb(${rgb} / 0.2), rgb(${rgb} / 0.9))` }}
      />
    </span>
  );
}

const GREEN = "52 211 153";
const AMBER = "251 191 36";
const VIOLET = "167 139 250";

export function MonthHeader({ label }: { label: string }) {
  return (
    <div className="relative flex px-4 pt-[18px] pb-1 lg:justify-end">
      <span className="text-xs font-semibold tracking-[0.08em] text-faint uppercase">{label}</span>
      <span
        aria-hidden="true"
        className="absolute top-[19px] -right-[67px] hidden size-3.5 rounded-full border-2 border-input bg-background lg:block"
      />
    </div>
  );
}

export function ShippedEntry({ item, dateLabel, latest }: { item: ShippedItem; dateLabel: string; latest: boolean }) {
  const { t } = useI18n();
  const star = item.stars !== undefined;
  const rgb = star ? AMBER : GREEN;

  return (
    <SpotlightCard
      as="article"
      bare
      rgb={rgb}
      reach={340}
      className="group rounded-[14px] border border-transparent px-4 py-3 transition-colors duration-200 hover:bg-card"
    >
      <Connector side="left" top={24} rgb={rgb} />
      <span
        aria-hidden="true"
        className={cn(
          "absolute hidden items-center justify-center rounded-full transition-[background-color,box-shadow] duration-200 lg:flex",
          star
            ? "top-4 -right-[69px] size-4 bg-tone-amber shadow-[0_0_8px_rgb(251_191_36/0.7)] group-hover:shadow-[0_0_18px_rgb(251_191_36/0.7)]"
            : "top-[18px] -right-[67px] size-3",
          !star &&
            (latest
              ? "bg-tone-green shadow-[0_0_0_4px_rgb(52_211_153/0.18),0_0_14px_rgb(52_211_153/0.8)]"
              : "border-2 border-tone-green bg-background group-hover:bg-tone-green group-hover:shadow-[0_0_0_4px_rgb(52_211_153/0.18),0_0_14px_rgb(52_211_153/0.8)]")
        )}
      >
        {star && <Star className="size-[9px] fill-tone-ink text-tone-ink" />}
      </span>

      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        {star ? (
          <span className="rounded-full bg-tone-amber/14 px-2 py-px text-xs font-medium text-tone-amber">
            {t("roadmap.community")}
          </span>
        ) : (
          item.version && (
            <span className="rounded-md bg-tone-green/12 px-2 py-px font-mono text-xs font-medium text-tone-green">
              {item.version}
            </span>
          )
        )}
        {dateLabel}
        <a
          href={shippedHref(item)}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "ml-auto inline-flex items-center gap-1 text-xs font-medium text-faint transition-colors duration-200",
            star ? "group-hover:text-tone-amber" : "group-hover:text-tone-green"
          )}
        >
          {item.link ? t("roadmap.viewOnGithub") : t("roadmap.viewInChangelog")}
          <ArrowUpRight className="size-3" />
        </a>
      </div>
      <h3 className="mt-1.5 mb-0.5 text-base leading-snug font-semibold tracking-[-0.01em]">
        {t(`roadmap.shipped.${item.slug}.title`)}
      </h3>
      <p className="text-[13.5px] leading-normal text-muted-foreground">{t(`roadmap.shipped.${item.slug}.description`)}</p>
    </SpotlightCard>
  );
}

function SideNode({ top, className }: { top: number; className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute -left-[67px] hidden size-3 rounded-full transition-[background-color,box-shadow] duration-200 lg:block",
        className
      )}
      style={{ top }}
    />
  );
}

export function GroupHeader({
  label,
  sub,
  count,
  tone,
  note,
}: {
  label: string;
  sub: string;
  count: number;
  tone: "violet" | "amber";
  note?: string;
}) {
  return (
    <div className="relative flex items-center gap-2 px-4 pt-[18px] pb-1">
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[19px] -left-[67px] hidden size-3.5 rounded-full border-2 bg-background lg:block",
          tone === "violet"
            ? "border-tone-violet shadow-[0_0_12px_rgb(167_139_250/0.6)]"
            : "border-tone-amber shadow-[0_0_12px_rgb(251_191_36/0.5)]"
        )}
      />
      <span
        className={cn(
          "text-xs font-semibold tracking-[0.08em] uppercase",
          tone === "violet" ? "text-tone-violet" : "text-tone-amber"
        )}
      >
        {label}
      </span>
      <span className="text-[13px] text-muted-foreground">{sub}</span>
      <span className="rounded-full border border-border-strong px-[7px] text-[11px] text-muted-foreground tabular-nums">
        {count}
      </span>
      {note && <span className="ml-auto hidden text-xs text-faint sm:block">{note}</span>}
    </div>
  );
}

export function PlannedCard({ item }: { item: RoadmapItem }) {
  const { t } = useI18n();
  return (
    <SpotlightCard
      as="article"
      bare
      rgb={VIOLET}
      reach={340}
      className="group flex flex-col rounded-2xl border border-tone-violet/22 bg-card p-[18px] shadow-[inset_0_1px_0_rgb(167_139_250/0.2)] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--lift-shadow)]"
    >
      <Connector side="right" top={28} rgb={VIOLET} />
      <SideNode
        top={22}
        className="border-2 border-tone-violet bg-background group-hover:bg-tone-violet group-hover:shadow-[0_0_0_4px_rgb(167_139_250/0.18),0_0_14px_rgb(167_139_250/0.8)]"
      />
      <span className="self-start">
        <CategoryPill category={item.category} />
      </span>
      <h3 className="mt-3 mb-1.5 text-lg leading-snug font-semibold tracking-[-0.015em]">
        {t(`roadmap.items.${item.slug}.title`)}
      </h3>
      <p className="leading-relaxed text-muted-foreground">{t(`roadmap.items.${item.slug}.description`)}</p>
    </SpotlightCard>
  );
}

export function IdeaRow({
  item,
  expanded,
  onToggle,
}: {
  item: RoadmapItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <SpotlightCard
      as="article"
      bare
      rgb={AMBER}
      reach={340}
      className={cn(
        "group flex flex-col rounded-[14px] border bg-card transition-colors duration-200",
        expanded ? "border-tone-amber/40" : "border-border"
      )}
    >
      <Connector side="right" top={24} rgb={AMBER} lit={expanded} />
      <SideNode
        top={18}
        className={cn(
          expanded
            ? "bg-tone-amber shadow-[0_0_0_4px_rgb(251_191_36/0.18),0_0_14px_rgb(251_191_36/0.8)]"
            : "border-2 border-tone-amber/55 bg-background group-hover:bg-tone-amber group-hover:shadow-[0_0_0_4px_rgb(251_191_36/0.18),0_0_14px_rgb(251_191_36/0.8)]"
        )}
      />
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full flex-col gap-1 px-3.5 py-3 text-left"
      >
        <span className="flex w-full items-center gap-2.5">
          <span className="min-w-0 grow text-[15px] font-semibold tracking-[-0.01em]">
            {t(`roadmap.items.${item.slug}.title`)}
          </span>
          {item.issueNumber && <span className="font-mono text-xs text-faint">#{item.issueNumber}</span>}
          <span className="hidden sm:inline-flex">
            <CategoryPill category={item.category} />
          </span>
          <ChevronDown
            className={cn("size-3.5 shrink-0 text-faint transition-transform duration-200", expanded && "rotate-180")}
          />
        </span>
        <span
          className={cn(
            "block",
            expanded ? "pt-1 leading-relaxed text-muted-foreground" : "truncate text-[13px] text-faint"
          )}
        >
          {t(`roadmap.items.${item.slug}.description`)}
        </span>
      </button>
      {expanded && item.issueNumber && (
        <a
          href={issueHref(item.issueNumber)}
          target="_blank"
          rel="noreferrer"
          className="fx-in mx-3.5 -mt-1 mb-3 inline-flex w-fit items-center gap-1 text-xs font-medium text-tone-amber"
        >
          {t("roadmap.issueOnGithub", { number: String(item.issueNumber) })}
          <ArrowUpRight className="size-3" />
        </a>
      )}
    </SpotlightCard>
  );
}
