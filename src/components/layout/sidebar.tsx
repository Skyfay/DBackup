import { Database, HardDrive, Inbox, LayoutDashboard, Settings } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Overview", icon: LayoutDashboard, href: "#overview" },
  { label: "Backups", icon: Database, href: "#backups" },
  { label: "Storage", icon: HardDrive, href: "#storage" },
  { label: "Notifications", icon: Inbox, href: "#notifications" },
  { label: "Settings", icon: Settings, href: "#settings" },
];

interface SidebarProps {
  active?: string;
}

export function Sidebar({ active }: SidebarProps) {
  return (
    <aside className="hidden h-screen w-64 flex-col border-r bg-card/50 p-4 lg:flex">
      <div className="flex items-center gap-3 px-2 py-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold">
          BK
        </div>
        <div className="flex flex-col">
          <span className="text-sm text-muted-foreground">control plane</span>
          <span className="text-base font-semibold">Backup Manager</span>
        </div>
      </div>
      <nav className="mt-6 flex flex-1 flex-col gap-1 text-sm">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.href;
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                isActive && "bg-accent text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
              {item.label === "Backups" && (
                <Badge variant="info" className="ml-auto">
                  Live
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Tip</p>
        <p className="mt-1">
          Modelle für Speicher und Benachrichtigungen sitzen entkoppelt. Neue
          Targets kannst du ohne Code-Duplikate anbinden.
        </p>
      </div>
    </aside>
  );
}
