import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DATABASES, STORAGE_ADAPTERS, NOTIFICATION_CHANNELS } from "@/lib/content";

const GROUPS = [
  { value: "databases", label: "Databases", items: DATABASES },
  { value: "storage", label: "Storage", items: STORAGE_ADAPTERS },
  { value: "notifications", label: "Notifications", items: NOTIFICATION_CHANNELS },
];

export function Integrations() {
  return (
    <section className="border-y border-border/60 bg-card/40">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Connects to what you already run
          </h2>
          <p className="mt-3 text-muted-foreground">
            8 database engines, 13+ storage destinations, and 9 notification
            channels - out of the box.
          </p>
        </div>

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
              <div className="flex flex-wrap justify-center gap-2">
                {group.items.map((item) => (
                  <Badge key={item} variant="secondary" className="px-3 py-1 text-sm">
                    {item}
                  </Badge>
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
