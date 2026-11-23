"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight, Building2, Network, Search, Share2, Ticket, UsersRound, type LucideIcon } from "lucide-react";
import { SpotlightCard } from "@/components/site/spotlight-card";
import { Glow } from "@/components/site/fx";
import { TENANTS_GUIDE_URL } from "@/lib/content";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/translate";

const POINTS: { icon: LucideIcon; label: MessageKey }[] = [
  { icon: UsersRound, label: "features.tenantsPlatformGroups" },
  { icon: Ticket, label: "features.tenantsInvitations" },
  { icon: Share2, label: "features.tenantsSharing" },
  { icon: Network, label: "features.tenantsNetwork" },
];

/**
 * The tenants of an MSP as the head of the sidebar lists them: the tenant of
 * the MSP that shares with its customers first, then the customers with the
 * databases they got from it. Names of customers read the same in every
 * language.
 */
const TENANTS = [
  { name: "Northwind IT", jobs: 12, databases: 48, shares: true },
  { name: "Acme", jobs: 4, databases: 9, shared: 3 },
  { name: "Globex", jobs: 6, databases: 14, shared: 2, failed: true },
  { name: "Initech", jobs: 3, databases: 5, shared: 5 },
];

/** -1 stands for All tenants. */
const ALL = -1;

export function TenantsCard({ className }: { className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(ALL);
  const current = open === ALL ? undefined : TENANTS[open];

  return (
    <SpotlightCard
      rgb="167 139 250"
      className={cn("grid grid-cols-1 gap-6 rounded-[22px] p-6 lg:grid-cols-[5fr_6fr] lg:gap-10", className)}
    >
      <Glow color="#a78bfa" opacity={0.16} blur={80} drift={2} className="-bottom-24 -left-16 size-72" />

      <div className="relative flex flex-col gap-4">
        <span className="flex size-11 items-center justify-center rounded-xl bg-tone-violet/14 text-tone-violet">
          <Building2 className="size-[22px]" />
        </span>
        <div>
          <h3 className="text-lg font-semibold tracking-[-0.02em]">{t("features.tenantsTitle")}</h3>
          <p className="mt-1.5 leading-[1.55] text-muted-foreground">{t("features.tenantsText")}</p>
        </div>
        <ul className="flex flex-col gap-2.5 text-[13px]">
          {POINTS.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-start gap-2.5">
              <Icon aria-hidden="true" className="mt-px size-4 shrink-0 text-tone-violet" />
              {t(label)}
            </li>
          ))}
        </ul>
        <a
          href={TENANTS_GUIDE_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-auto inline-flex w-fit items-center gap-1 text-[13px] font-medium text-tone-violet"
        >
          {t("features.tenantsGuide")}
          <ArrowUpRight className="size-3.5" />
        </a>
      </div>

      <div className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface text-[13px]">
        <div className="flex items-center gap-3 border-b border-border p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-tone-violet/14 text-xs font-semibold text-tone-violet">
            {current ? current.name.slice(0, 2).toUpperCase() : <Building2 aria-hidden="true" className="size-4" />}
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold">{current ? current.name : t("features.allTenants")}</div>
            <div className="truncate text-xs text-muted-foreground">
              {current
                ? t("features.tenantOf", { index: open + 1, total: TENANTS.length })
                : t("features.tenantCount", { count: TENANTS.length })}
            </div>
          </div>
        </div>

        <div aria-hidden="true" className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-faint">
          <Search className="size-3.5" />
          {t("features.findTenant")}
        </div>

        <div role="group" aria-label={t("features.tenantsSwitcher")} className="flex flex-col gap-0.5 p-1.5 pt-2">
          <TenantRow active={open === ALL} onClick={() => setOpen(ALL)}>
            <span className="truncate font-medium">{t("features.allTenants")}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{TENANTS.length}</span>
          </TenantRow>
          {TENANTS.map((tenant, i) => (
            <TenantRow key={tenant.name} active={open === i} onClick={() => setOpen(i)}>
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{tenant.name}</span>
                  {tenant.failed && (
                    <span
                      role="img"
                      aria-label={t("features.tenantFailed")}
                      title={t("features.tenantFailed")}
                      className="size-2 shrink-0 rounded-full bg-tone-red shadow-[0_0_8px_rgb(248_113_113/0.7)]"
                    />
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {t("features.tenantStats", { jobs: tenant.jobs, databases: tenant.databases })}
                </span>
              </span>
              <span
                className={cn(
                  "ml-auto shrink-0 rounded-full px-2 py-px text-[11px] font-medium",
                  tenant.shares ? "bg-tone-violet/14 text-tone-violet" : "bg-tone-blue/14 text-tone-blue-soft"
                )}
              >
                {tenant.shares ? t("features.sharesWithCustomers") : t("features.tenantShared", { count: tenant.shared ?? 0 })}
              </span>
            </TenantRow>
          ))}
        </div>
      </div>
    </SpotlightCard>
  );
}

function TenantRow({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-accent/60"
      )}
    >
      {children}
    </button>
  );
}
