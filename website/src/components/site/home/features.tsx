import { SpotlightCard } from "@/components/site/spotlight-card";
import { Eyebrow, Glow } from "@/components/site/fx";
import { ToneDialogCard } from "@/components/site/home/tone-dialog-card";
import { CommandCard } from "@/components/site/home/command-card";
import { CalendarCard } from "@/components/site/home/calendar-card";
import { CipherCard, TeamCard } from "@/components/site/home/small-cards";
import { NOTIFICATION_CHANNELS } from "@/lib/content";

function AlertsCard() {
  return (
    <SpotlightCard className="flex flex-col gap-3.5 rounded-[22px] p-6">
      <div className="relative">
        <h3 className="text-lg font-semibold tracking-[-0.02em]">Alerts where you are</h3>
        <p className="mt-1.5 text-muted-foreground">
          {NOTIFICATION_CHANNELS.length} channels, per job or system wide.
        </p>
      </div>
      <div aria-hidden="true" className="relative h-[150px]">
        <div className="absolute inset-x-4 top-0 rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-muted-foreground opacity-60">
          Email · Weekly summary
        </div>
        <div className="absolute inset-x-2 top-6 rounded-xl border border-border-strong bg-surface-2 px-3 py-2.5 text-xs text-muted-foreground shadow-[0_6px_16px_-8px_rgb(0_0_0/0.15)] dark:shadow-[0_6px_16px_-8px_rgb(0_0_0/0.8)]">
          <span className="text-tone-amber">ntfy</span> · Backup missing for 26 hours
        </div>
        <div className="absolute inset-x-0 top-[52px] flex gap-2.5 rounded-xl border border-input bg-accent p-3 text-[13px] shadow-[0_16px_30px_-12px_rgb(0_0_0/0.2)] dark:shadow-[0_16px_30px_-12px_rgb(0_0_0/0.9)] dark:bg-[#1f1f22]">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-tone-blue/14 text-[10px] font-semibold text-tone-blue-soft">
            DC
          </span>
          <div>
            <div className="font-semibold">Discord · #backups</div>
            <div className="text-muted-foreground">Postgres nightly finished in 4 min 12 s</div>
          </div>
        </div>
      </div>
    </SpotlightCard>
  );
}

function RetentionCard() {
  return (
    <SpotlightCard className="flex flex-col gap-3.5 rounded-[22px] p-6">
      <div className="relative">
        <h3 className="text-lg font-semibold tracking-[-0.02em]">Retention, reused</h3>
        <p className="mt-1.5 text-muted-foreground">GFS templates shared by every job.</p>
      </div>
      <dl className="relative mt-auto grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border">
        {[
          ["Daily", "7"],
          ["Weekly", "4"],
          ["Monthly", "12"],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse bg-surface p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-[22px] font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </SpotlightCard>
  );
}

export function Features() {
  return (
    <section id="features" className="relative px-6 pt-[150px]">
      <div
        aria-hidden="true"
        className="absolute top-0 left-1/2 h-px w-[min(1100px,100%)] -translate-x-1/2"
        style={{ background: "linear-gradient(90deg, transparent, rgb(96 165 250 / 0.5), rgb(167 139 250 / 0.5), transparent)" }}
      />
      <Glow color="#2563eb" opacity={0.1} blur={100} className="top-10 left-1/2 h-[300px] w-[min(900px,100%)] -translate-x-1/2" />

      <div className="relative mx-auto flex max-w-[1200px] flex-col gap-10">
        <div className="flex flex-col items-center gap-3.5 text-center">
          <Eyebrow>Features</Eyebrow>
          <h2 className="max-w-[780px] text-[34px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[48px]">
            Everything a backup needs,{" "}
            <span className="fx-shine">in the interface you will actually use.</span>
          </h2>
          <p className="hidden text-faint [@media(pointer:fine)]:block">Move the mouse over the cards.</p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <ToneDialogCard className="md:col-span-2 lg:row-span-2" />
          <CommandCard className="md:col-span-2 lg:col-span-1 lg:row-span-2" />
          <CalendarCard className="md:col-span-2" />
          <CipherCard />
          <AlertsCard />
          <RetentionCard />
          <TeamCard />
        </div>
      </div>
    </section>
  );
}
