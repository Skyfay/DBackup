import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdapterIcon } from "@/components/site/adapter-icon";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";
import { DATABASES, STORAGE_ADAPTERS, NOTIFICATION_CHANNELS } from "@/lib/content";

const GROUPS = [
  { value: "databases", label: "Databases", items: DATABASES },
  { value: "storage", label: "Storage", items: STORAGE_ADAPTERS },
  { value: "notifications", label: "Notifications", items: NOTIFICATION_CHANNELS },
];

export function Integrations() {
  return (
    <section className="relative border-y border-border/60 bg-card/40">
      <div className="bg-dot-grid absolute inset-0 -z-10 opacity-40" />
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <SectionHeading
          eyebrow="Integrations"
          title="Connects to what you already run"
          description="8 database engines, 13 storage destinations, and 9 notification channels - out of the box."
        />

        <Reveal>
          <Tabs defaultValue="databases" className="mt-12">
            <TabsList className="mx-auto">
              {GROUPS.map((group) => (
                <TabsTrigger key={group.value} value={group.value}>
                  {group.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {GROUPS.map((group) => (
              <TabsContent key={group.value} value={group.value}>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                  {group.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/50 p-4 text-center transition-all hover:border-primary/40 hover:bg-card"
                    >
                      <div className="flex size-8 items-center justify-center rounded-lg bg-muted sm:size-10">
                        <AdapterIcon adapterId={item.id} className="size-5 sm:size-6" />
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">
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
