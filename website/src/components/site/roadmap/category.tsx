import { Activity, Archive, Code, Database, HardDrive, Shield, type LucideIcon } from "lucide-react";
import { ROADMAP_CATEGORIES, type RoadmapCategory } from "@/lib/roadmap";

export const CATEGORY_ICON: Record<RoadmapCategory, LucideIcon> = {
  "backup-engine": Archive,
  storage: HardDrive,
  "monitoring-dashboard": Activity,
  "database-tools": Database,
  "security-access": Shield,
  "developer-experience": Code,
};

export const CATEGORY_LABEL = Object.fromEntries(
  ROADMAP_CATEGORIES.map((c) => [c.value, c.label])
) as Record<RoadmapCategory, string>;

export function CategoryPill({ category }: { category: RoadmapCategory }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-border-strong bg-surface px-2 text-xs font-medium whitespace-nowrap text-muted-foreground">
      <Icon className="size-3" />
      {CATEGORY_LABEL[category]}
    </span>
  );
}
