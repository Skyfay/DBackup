"use client";

import { Activity, Archive, Code, Database, HardDrive, Shield, type LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import type { RoadmapCategory } from "@/lib/roadmap";

export const CATEGORY_ICON: Record<RoadmapCategory, LucideIcon> = {
  "backup-engine": Archive,
  storage: HardDrive,
  "monitoring-dashboard": Activity,
  "database-tools": Database,
  "security-access": Shield,
  "developer-experience": Code,
};

export function CategoryPill({ category }: { category: RoadmapCategory }) {
  const { t } = useI18n();
  const Icon = CATEGORY_ICON[category];
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-border-strong bg-surface px-2 text-xs font-medium whitespace-nowrap text-muted-foreground">
      <Icon className="size-3" />
      {t(`roadmap.category.${category}`)}
    </span>
  );
}
