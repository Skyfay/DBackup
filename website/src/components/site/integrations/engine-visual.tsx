import { Check, ShieldCheck } from "lucide-react";
import { CompressionPicker } from "@/components/site/integrations/compression-picker";
import type { Locale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import { DATABASE_PAGES, type DatabaseSlug } from "@/lib/integrations";

// What a database page shows beside the text on its engine: the native
// compression of PostgreSQL, the dump switches of MySQL and MariaDB, the hosts
// MongoDB takes and the steps of the Redis restore script.

/** The options of pg_dump the job offers, with the -Z each one passes. */
function Compression({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const level = (min: number, max: number, def: number) => ({
    min,
    max,
    default: def,
    label: t("integrations.compression.level", { level: def }),
  });
  return (
    <CompressionPicker
      initial={2}
      labels={{
        group: t("integrations.compression.group"),
        faster: t("integrations.compression.faster"),
        smaller: t("integrations.compression.smaller"),
      }}
      options={[
        {
          name: "Gzip",
          needs: t("integrations.compression.everyVersion"),
          title: t("integrations.compression.gzipTitle"),
          text: t("integrations.compression.gzipText"),
          levels: level(0, 9, 6),
          command: "pg_dump -F c -Z 6 -d shop",
        },
        {
          name: "LZ4",
          needs: t("integrations.compression.from", { version: 14 }),
          title: t("integrations.compression.lz4Title"),
          text: t("integrations.compression.lz4Text"),
          levels: level(0, 9, 1),
          command: "pg_dump -F c -Z lz4:1 -d shop",
        },
        {
          name: "Zstd",
          needs: t("integrations.compression.from", { version: 16 }),
          title: t("integrations.compression.zstdTitle"),
          text: t("integrations.compression.zstdText"),
          levels: level(1, 22, 3),
          command: "pg_dump -F c -Z zstd:3 -d shop",
        },
        {
          name: t("integrations.compression.noneName"),
          needs: t("integrations.compression.everyVersion"),
          title: t("integrations.compression.noneTitle"),
          text: t("integrations.compression.noneText"),
          command: "pg_dump -F c -Z 0 -d shop",
        },
      ]}
    />
  );
}

function Options({ locale, flags }: { locale: Locale; flags: [MessageKey, MessageKey, string][] }) {
  const t = createTranslator(locale);
  return (
    <div className="flex flex-col gap-3">
      <ul className="panel flex flex-col divide-y divide-border rounded-[18px]">
        {flags.map(([title, text, flag]) => (
          <li key={flag} className="flex items-start gap-4 p-[18px]">
            <span className="flex min-w-0 grow flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 font-semibold">
                {t(title)}
                <code className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-normal text-subtle">{flag}</code>
              </span>
              <span className="text-[13px] leading-relaxed text-muted-foreground">{t(text)}</span>
            </span>
            <span
              role="img"
              aria-label={t("integrations.options.on")}
              className="mt-0.5 flex h-5 w-9 shrink-0 items-center justify-end rounded-full bg-[#3f3f46] p-0.5 dark:bg-[#d4d4d8]"
            >
              <span className="size-4 rounded-full bg-white shadow-sm dark:bg-[#18181b]" />
            </span>
          </li>
        ))}
      </ul>
      <p className="panel flex gap-3 rounded-[14px] px-4 py-3.5 text-[13px] leading-relaxed text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-tone-green" />
        {t("integrations.options.check")}
      </p>
    </div>
  );
}

function Hosts({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const hosts: [string, MessageKey, MessageKey][] = [
    ["cluster0.abcde.mongodb.net", "integrations.db.mongodb.badgeSrv", "integrations.db.mongodb.hostAtlas"],
    ["mongodb+srv://mongo.example.com", "integrations.db.mongodb.badgeSrv", "integrations.db.mongodb.hostSrv"],
    ["db1:27017,db2:27017,db3:27017", "integrations.db.mongodb.badgeSeeds", "integrations.db.mongodb.hostSeeds"],
    ["mongo", "integrations.db.mongodb.badgeSingle", "integrations.db.mongodb.hostSingle"],
  ];
  return (
    <ul className="flex flex-col gap-2.5">
      {hosts.map(([host, badge, text]) => (
        <li key={host} className="panel flex flex-col gap-2 rounded-[16px] p-4">
          <span className="flex flex-wrap items-center gap-2.5">
            <code className="min-w-0 truncate rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-[13px]">{host}</code>
            <span className="rounded-full bg-tone-green/14 px-2 py-0.5 text-xs font-medium text-tone-green">{t(badge)}</span>
          </span>
          <span className="text-[13px] leading-relaxed text-muted-foreground">{t(text)}</span>
        </li>
      ))}
    </ul>
  );
}

function RestoreGuide({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const hosts: MessageKey[] = [
    "integrations.db.redis.guideDocker",
    "integrations.db.redis.guideCompose",
    "integrations.db.redis.guideLinux",
    "integrations.db.redis.guideWindows",
  ];
  const steps: MessageKey[] = [
    "integrations.db.redis.guide1",
    "integrations.db.redis.guide2",
    "integrations.db.redis.guide3",
    "integrations.db.redis.guide4",
  ];
  return (
    <div className="panel flex flex-col gap-5 rounded-[18px] p-[22px]">
      <div className="flex flex-wrap gap-2">
        {hosts.map((host) => (
          <span key={host} className="rounded-full bg-muted px-3 py-1 text-[13px] font-medium text-subtle">
            {t(host)}
          </span>
        ))}
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((step, i) => (
          <li key={step} className="flex items-start gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
              {i + 1}
            </span>
            <span className="leading-relaxed">{t(step)}</span>
          </li>
        ))}
      </ol>
      <p className="flex items-center gap-2 border-t border-border pt-4 text-[13px] text-muted-foreground">
        <Check aria-hidden="true" className="size-4 shrink-0 text-tone-green" />
        {t("integrations.db.redis.guideScript")}
      </p>
    </div>
  );
}

const MYSQL_FLAGS: [MessageKey, MessageKey, string][] = [
  ["integrations.options.snapshotTitle", "integrations.options.snapshotText", "--single-transaction"],
  ["integrations.options.routinesTitle", "integrations.options.routinesText", "--routines"],
  ["integrations.options.eventsTitle", "integrations.options.eventsText", "--events"],
];

export function EngineVisual({ slug, locale }: { slug: DatabaseSlug; locale: Locale }) {
  const feature = DATABASE_PAGES[slug].feature;
  if (feature === "compression") return <Compression locale={locale} />;
  if (feature === "options") return <Options locale={locale} flags={MYSQL_FLAGS} />;
  if (feature === "hosts") return <Hosts locale={locale} />;
  return <RestoreGuide locale={locale} />;
}
