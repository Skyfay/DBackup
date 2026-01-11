import { ReactNode } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { Separator } from "@/components/ui/separator";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-muted/20 text-foreground">
      <Sidebar />
      <div className="flex w-full flex-col">
        <header className="flex items-center justify-between border-b bg-background/80 px-6 py-4 backdrop-blur">
          <div className="flex flex-col">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Backup Control Plane
            </p>
            <h1 className="text-xl font-semibold">Datastores & Alerts</h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex h-2 w-2 items-center justify-center rounded-full bg-emerald-500" />
            <span>Scheduler aktiv</span>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <span className="hidden sm:inline">Heute: {new Date().toLocaleDateString()}</span>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
