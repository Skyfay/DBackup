import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { SpinBorder } from "@/components/site/fx";
import { CategoryPill } from "@/components/site/roadmap/category";
import { StarMilestone } from "@/components/site/roadmap/star-milestone";
import { MILESTONES, ROADMAP_ITEMS, SHIPPED_ITEMS, shippedHref } from "@/lib/roadmap";
import { formatDate } from "@/lib/utils";

const CONIC_NOW =
  "conic-gradient(from 0deg, transparent 0deg 250deg, #34d399 290deg, #60a5fa 320deg, #a78bfa 345deg, transparent 360deg)";

function Label({ dot, children }: { dot: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-faint uppercase">
      {dot}
      {children}
    </span>
  );
}

/** The top of the spine: the last release, what is being built and the next goal. */
export function NowSection() {
  const latest = SHIPPED_ITEMS.find((s) => !s.star) ?? SHIPPED_ITEMS[0];
  const inProgress = ROADMAP_ITEMS.filter((i) => i.status === "in-progress");
  const milestone = MILESTONES[0];
  const reached = SHIPPED_ITEMS.filter((s) => s.star)
    .map((s) => ({ value: parseInt(s.title, 10), date: s.releaseDate }))
    .filter((s) => !Number.isNaN(s.value))
    .sort((a, b) => a.value - b.value)
    .map((s) => ({ value: s.value, label: `${s.value} · ${formatDate(s.date).replace(/, \d{4}$/, "")}` }));

  return (
    <section aria-label="Now" className="relative z-[2] mx-auto mt-16 flex max-w-[1248px] flex-col items-center px-6">
      <div
        aria-hidden="true"
        className="fx-drift pointer-events-none absolute -top-[90px] left-1/2 -ml-[430px] h-[440px] w-[860px] rounded-full"
        style={{
          background: "radial-gradient(closest-side, rgb(96 165 250 / 0.42), rgb(167 139 250 / 0.18), transparent)",
          filter: "blur(30px)",
          opacity: "var(--glow-strength)",
        }}
      />
      <span className="fx-orb relative flex size-14 items-center justify-center rounded-full border border-tone-blue-soft/55 bg-[radial-gradient(circle_at_50%_30%,#bfdbfe,#ffffff_70%)] dark:bg-[radial-gradient(circle_at_50%_30%,#1e3a8a,#0d0d0f_70%)]">
        <Image src="/logo.svg" alt="" width={30} height={30} />
      </span>
      <span className="relative mt-2.5 rounded-full bg-tone-blue/14 px-2.5 py-0.5 text-xs font-semibold tracking-[0.08em] text-tone-blue-soft uppercase">
        Now
      </span>
      <span
        aria-hidden="true"
        className="relative h-7 w-0.5"
        style={{ background: "linear-gradient(var(--tone-blue-soft), color-mix(in srgb, var(--tone-blue-soft) 35%, transparent))" }}
      />

      <SpinBorder
        conic={CONIC_NOW}
        speed="normal"
        radius={22}
        className="w-full shadow-[0_40px_100px_-40px_rgb(37_99_235/0.6)]"
        innerClassName="grid bg-card md:grid-cols-3"
      >
        <div className="flex flex-col gap-3 border-b border-border p-6 md:border-r md:border-b-0">
          <Label dot={<span className="size-2 rounded-full bg-tone-green shadow-[0_0_10px_rgb(52_211_153/0.8)]" />}>
            Last shipped
          </Label>
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            {latest.version && (
              <span className="rounded-md bg-tone-green/12 px-2 py-px font-mono text-xs font-medium text-tone-green">
                {latest.version}
              </span>
            )}
            {formatDate(latest.releaseDate)}
          </span>
          <span className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">{latest.title}</span>
          <a
            href={shippedHref(latest)}
            target="_blank"
            rel="noreferrer"
            className="mt-auto inline-flex w-fit items-center gap-1 text-[13px] font-medium text-tone-green"
          >
            View in changelog
            <ArrowUpRight className="size-3.5" />
          </a>
        </div>

        <div className="flex flex-col gap-3 border-b border-border bg-[radial-gradient(420px_circle_at_50%_0%,rgb(96_165_250/0.12),transparent_70%)] p-6 md:border-r md:border-b-0">
          <Label
            dot={
              <span className="relative size-2">
                {inProgress.length > 0 && <span className="fx-ping absolute inset-0 rounded-full bg-tone-blue" />}
                <span className="absolute inset-0 rounded-full bg-tone-blue shadow-[0_0_10px_rgb(96_165_250/0.8)]" />
              </span>
            }
          >
            In progress
            <span className="rounded-full border border-border-strong px-[7px] text-[11px] tracking-normal text-muted-foreground tabular-nums">
              {inProgress.length}
            </span>
          </Label>
          {inProgress.map((item) => (
            <div
              key={item.slug}
              className="flex flex-col gap-2 rounded-xl border border-tone-blue/32 bg-tone-blue/6 px-3.5 py-3"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="grow text-base font-semibold">{item.title}</span>
                <CategoryPill category={item.category} />
              </span>
              <span aria-hidden="true" className="relative h-1 overflow-hidden rounded-full bg-muted">
                <span className="fx-indet absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-transparent via-tone-blue to-transparent" />
              </span>
            </div>
          ))}
          {inProgress.length === 0 && (
            <>
              <span className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">Nothing marked in progress</span>
              <span className="leading-[1.55] text-muted-foreground">
                No item is marked in progress right now. Planned work moves here once it starts.
              </span>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 p-6">
          <Label dot={<span className="size-2 rounded-full bg-tone-amber shadow-[0_0_10px_rgb(251_191_36/0.8)]" />}>
            Next milestone
          </Label>
          {milestone && <StarMilestone milestone={milestone} reached={reached} />}
        </div>
      </SpinBorder>
    </section>
  );
}
