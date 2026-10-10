"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, Search } from "lucide-react";
import { AdapterIcon } from "@/components/site/adapter-icon";
import { Glow } from "@/components/site/fx";
import {
  DATABASES,
  NOTIFICATION_CHANNELS,
  STORAGE_ADAPTERS,
  adapterName,
  type AdapterItem,
} from "@/lib/content";
import {
  DATABASE_COLORS,
  DUMP_TOOL,
  adapterDocsUrl,
  isAdapterKindId,
  isDatabaseCardId,
  pageOfAdapter,
  type DatabaseCardId,
} from "@/lib/integrations";
import { needsDarkModeBoost } from "@/lib/adapter-icons";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import type { MessageKey, Translator } from "@/i18n/translate";

type Kind = "all" | "database" | "storage" | "notification";

function matches(query: string, ...parts: string[]) {
  const q = query.trim().toLowerCase();
  return !q || parts.some((part) => part.toLowerCase().includes(q));
}

function Logo({ id, size }: { id: string; size: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center bg-muted",
        size === "lg" ? "size-11 rounded-xl" : "size-[34px] rounded-[9px]"
      )}
    >
      <AdapterIcon
        adapterId={id}
        className={cn(size === "lg" ? "size-[22px]" : "size-[18px]", needsDarkModeBoost(id) && "dark:brightness-200 dark:contrast-125")}
      />
    </span>
  );
}

function SectionHead({ title, text, count }: { title: string; text: string; count: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[28px] font-semibold tracking-[-0.03em]">{title}</h2>
        <p className="max-w-[580px] text-[15px] leading-relaxed text-muted-foreground">{text}</p>
      </div>
      <span className="text-faint">{count}</span>
    </div>
  );
}

function DatabaseCard({ item, id, t, path }: { item: AdapterItem; id: DatabaseCardId; t: Translator; path: (p: string) => string }) {
  const page = pageOfAdapter(id);
  const href = page ? path(`/integrations/${page}/`) : adapterDocsUrl("database", item.id);
  const Arrow = page ? ArrowRight : ArrowUpRight;
  return (
    <Link
      href={href}
      target={page ? undefined : "_blank"}
      rel={page ? undefined : "noreferrer"}
      className="group panel relative flex min-w-0 flex-col gap-3.5 overflow-hidden rounded-[18px] p-5 transition-[transform,border-color] duration-200 hover:-translate-y-[3px] hover:border-input"
    >
      <Glow color={DATABASE_COLORS[id]} opacity={0.2} blur={50} className="-top-[70px] -right-[50px] h-[150px] w-[190px]" />
      <span className="relative flex items-center gap-3">
        <Logo id={item.id} size="lg" />
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-semibold tracking-[-0.01em]">{adapterName(item, t)}</span>
          <span className="text-[13px] text-muted-foreground">{t(`integrations.cards.${id}.versions`)}</span>
        </span>
        {item.beta && (
          <span className="ml-auto rounded-full border border-input px-2 py-0.5 text-xs text-muted-foreground">{t("adapters.beta")}</span>
        )}
      </span>
      <span className="relative leading-relaxed text-muted-foreground">{t(`integrations.cards.${id}.text`)}</span>
      <span className="relative mt-auto flex items-center gap-2 border-t border-border pt-3.5 text-[13px]">
        <code className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-subtle">{DUMP_TOOL[id]}</code>
        <span className="text-faint">{page ? t("integrations.hub.readPage") : t("integrations.hub.readGuide")}</span>
        <Arrow className="ml-auto size-4 text-faint transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
      </span>
    </Link>
  );
}

function Tile({ item, kind, t }: { item: AdapterItem; kind: "storage" | "notification"; t: Translator }) {
  return (
    <a
      href={adapterDocsUrl(kind, item.id)}
      target="_blank"
      rel="noreferrer"
      className="panel flex min-w-0 items-center gap-3 rounded-[14px] px-3.5 py-3 transition-colors hover:border-input"
    >
      <Logo id={item.id} size="sm" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{adapterName(item, t)}</span>
        {isAdapterKindId(item.id) && <span className="truncate text-xs text-faint">{t(`integrations.kinds.${item.id}`)}</span>}
      </span>
      {item.beta && (
        <span className="ml-auto shrink-0 rounded-full border border-input px-2 py-0.5 text-xs text-muted-foreground">{t("adapters.beta")}</span>
      )}
    </a>
  );
}

/** The three lists of the integrations page, with a search and a filter by kind. */
export function IntegrationsDirectory() {
  const { t, path } = useI18n();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");

  const databases = DATABASES.flatMap((item) =>
    isDatabaseCardId(item.id) && matches(query, item.label, item.id, DUMP_TOOL[item.id]) ? [{ item, id: item.id }] : []
  );
  const storage = STORAGE_ADAPTERS.filter((item) => matches(query, item.label, adapterName(item, t), item.id));
  const alerts = NOTIFICATION_CHANNELS.filter((item) => matches(query, item.label, adapterName(item, t), item.id));
  const show = {
    database: (kind === "all" || kind === "database") && databases.length > 0,
    storage: (kind === "all" || kind === "storage") && storage.length > 0,
    notification: (kind === "all" || kind === "notification") && alerts.length > 0,
  };
  // The counts follow the search, so a kind with matches shows them before it is picked.
  const filters: [Kind, MessageKey, number][] = [
    ["all", "integrations.hub.all", databases.length + storage.length + alerts.length],
    ["database", "integrations.hub.databases", databases.length],
    ["storage", "integrations.hub.storage", storage.length],
    ["notification", "integrations.hub.notifications", alerts.length],
  ];
  const elsewhere = databases.length + storage.length + alerts.length > 0;

  return (
    <>
      <div className="relative z-[2] mx-auto mt-10 flex w-full max-w-[828px] flex-wrap justify-center gap-2.5 px-6">
        <label className="flex h-10 min-w-[240px] flex-[1_1_260px] items-center gap-2 rounded-[10px] border border-input bg-surface/80 px-3 text-faint focus-within:border-ring">
          <Search aria-hidden="true" className="size-4 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("integrations.hub.searchPlaceholder")}
            aria-label={t("integrations.hub.search")}
            className="min-w-0 grow bg-transparent text-sm text-foreground outline-none placeholder:text-faint"
          />
        </label>
        <div role="group" aria-label={t("integrations.hub.filter")} className="flex flex-wrap gap-0.5 rounded-[10px] border border-border bg-surface p-[3px]">
          {filters.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors",
                kind === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t(label)}
              <span className="font-normal text-faint">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {show.database && (
        <section id="databases" className="relative z-[2] mx-auto flex w-full max-w-[1248px] scroll-mt-28 flex-col gap-5 px-6 pt-[72px]">
          <SectionHead
            title={t("integrations.hub.databasesTitle")}
            text={t("integrations.hub.databasesText")}
            count={t("integrations.hub.engines", { count: databases.length })}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {databases.map(({ item, id }) => (
              <DatabaseCard key={id} item={item} id={id} t={t} path={path} />
            ))}
          </div>
        </section>
      )}

      {show.storage && (
        <section id="storage" className="relative z-[2] mx-auto flex w-full max-w-[1248px] scroll-mt-28 flex-col gap-5 px-6 pt-[72px]">
          <SectionHead
            title={t("integrations.hub.storageTitle")}
            text={t("integrations.hub.storageText")}
            count={t("integrations.hub.adapters", { count: storage.length })}
          />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {storage.map((item) => (
              <Tile key={item.id} item={item} kind="storage" t={t} />
            ))}
          </div>
        </section>
      )}

      {show.notification && (
        <section id="notifications" className="relative z-[2] mx-auto flex w-full max-w-[1248px] scroll-mt-28 flex-col gap-5 px-6 pt-[72px]">
          <SectionHead
            title={t("integrations.hub.notificationsTitle")}
            text={t("integrations.hub.notificationsText")}
            count={t("integrations.hub.channels", { count: alerts.length })}
          />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {alerts.map((item) => (
              <Tile key={item.id} item={item} kind="notification" t={t} />
            ))}
          </div>
        </section>
      )}

      {!show.database && !show.storage && !show.notification && (
        <section className="relative z-[2] mx-auto w-full max-w-[1248px] px-6 pt-[72px]">
          <div className="flex flex-col items-center gap-2.5 rounded-[18px] border border-dashed border-input px-6 py-12 text-center">
            {elsewhere ? (
              <>
                <p className="text-lg font-semibold">{t("integrations.hub.otherKind", { query: query.trim() })}</p>
                <button
                  type="button"
                  onClick={() => setKind("all")}
                  className="mt-1.5 flex h-9 items-center rounded-lg border border-input bg-secondary px-3.5 font-medium"
                >
                  {t("integrations.hub.showAllKinds")}
                </button>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold">{t("integrations.hub.emptyTitle", { query: query.trim() })}</p>
                <p className="max-w-[440px] leading-relaxed text-muted-foreground">{t("integrations.hub.emptyText")}</p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setKind("all");
                  }}
                  className="mt-1.5 flex h-9 items-center rounded-lg border border-input bg-secondary px-3.5 font-medium"
                >
                  {t("integrations.hub.showAll")}
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}
