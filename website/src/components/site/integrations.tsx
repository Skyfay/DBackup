import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdapterIcon } from "@/components/site/adapter-icon";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { DATABASES, STORAGE_ADAPTERS, NOTIFICATION_CHANNELS } from "@/lib/content";
import { needsDarkModeBoost } from "@/lib/adapter-icons";
import { cn } from "@/lib/utils";

const GROUPS = [
  { value: "databases", label: "Databases", items: DATABASES },
  { value: "storage", label: "Storage", items: STORAGE_ADAPTERS },
  { value: "notifications", label: "Notifications", items: NOTIFICATION_CHANNELS },
];

export function Integrations() {
  return (
    <section className="relative border-y border-border/60 bg-card/40 dark:border-transparent dark:bg-card/20">
      <div className="bg-dot-grid absolute inset-0 -z-10 opacity-40" />
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <SectionHeading
          eyebrow="Integrations"
          title="Connects to what you already run"
          description="9 database engines, 13 storage adapters that work as backup destinations or as directory sources, and 9 notification channels - out of the box."
        />

        <Reveal>
          <Tabs defaultValue="databases" className="mt-16 gap-8">
            <TabsList className="mx-auto">
              {GROUPS.map((group) => (
                <TabsTrigger key={group.value} value={group.value}>
                  {group.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {GROUPS.map((group) => (
              <TabsContent key={group.value} value={group.value}>
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
                  {group.items.map((item) => (
                    <div
                      key={item.id}
                      className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card/50 p-5 text-center transition-all hover:-translate-y-1 hover:border-primary/30 hover:bg-card hover:shadow-lg sm:p-6"
                    >
                      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 transition-colors group-hover:bg-primary/15 sm:size-14 dark:bg-primary/15 dark:group-hover:bg-primary/20">
                        <AdapterIcon
                          adapterId={item.id}
                          className={cn(
                            "size-6 sm:size-7",
                            needsDarkModeBoost(item.id) && "dark:brightness-200 dark:contrast-125",
                          )}
                        />
                      </div>
                      <span className="text-sm font-medium text-muted-foreground">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </Reveal>
      </div>
    </section>
  );
}
