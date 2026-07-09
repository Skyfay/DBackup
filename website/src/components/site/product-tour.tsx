import Image from "next/image";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SCREENSHOTS = [
  { value: "overview", label: "Overview", src: "/screenshots/overview.png" },
  { value: "jobs", label: "Jobs", src: "/screenshots/jobs.png" },
  { value: "storage", label: "Storage Explorer", src: "/screenshots/storage-explorer.png" },
  { value: "database", label: "Database Explorer", src: "/screenshots/database-explorer.png" },
  { value: "vault", label: "Vault", src: "/screenshots/vault.png" },
  { value: "security", label: "Security", src: "/screenshots/security.png" },
];

export function ProductTour() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight">See it in action</h2>
        <p className="mt-3 text-muted-foreground">
          A quick look at the dashboard, jobs, and explorers that make up the
          day-to-day of running DBackup.
        </p>
      </div>

      <Tabs defaultValue="overview" className="mt-12">
        <TabsList className="mx-auto h-auto flex-wrap">
          {SCREENSHOTS.map((shot) => (
            <TabsTrigger key={shot.value} value={shot.value}>
              {shot.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {SCREENSHOTS.map((shot) => (
          <TabsContent key={shot.value} value={shot.value}>
            <div className="overflow-hidden rounded-xl border border-border">
              <Image
                src={shot.src}
                alt={`DBackup ${shot.label} screenshot`}
                width={1200}
                height={750}
                className="h-auto w-full"
              />
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
